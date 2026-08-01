"""Postmark inbound webhook — a permanent front door for forwarded bookings.

Email ingestion needs a URL that outlives a laptop. A tunnel hostname changes
on every restart, and Postmark would go on POSTing to a dead address while every
forwarded booking vanished silently — the worst kind of failure, because nothing
reports it.

A Lambda Function URL is permanent, free at this volume, and needs no API
Gateway. This handler does the least it can: authenticate, persist the raw
payload to S3, and hand off. Extraction happens elsewhere, because a webhook
that does real work times out and Postmark retries it, producing duplicates.

The raw email is kept in S3 verbatim. When an extraction is later found to be
wrong, the only way to know whether the parser or the sender was at fault is to
re-read exactly what arrived.
"""
import base64
import hashlib
import hmac
import json
import os
from datetime import datetime, timezone

import boto3

BUCKET = os.environ.get("INBOUND_BUCKET", "")
USERNAME = os.environ.get("WEBHOOK_USERNAME", "")
PASSWORD = os.environ.get("WEBHOOK_PASSWORD", "")

s3 = boto3.client("s3")


def _authorised(headers: dict) -> bool:
    """Basic auth, compared in constant time.

    Postmark supports HTTP basic auth on inbound webhooks. Without it the URL is
    world-writable and anyone who learns it can inject bookings into a
    traveller's itinerary. `compare_digest` because a plain `==` on a secret
    leaks its length through timing.
    """
    if not USERNAME or not PASSWORD:
        # Refuse rather than run open. An unauthenticated inbox is worse than a
        # broken one.
        return False
    raw = headers.get("authorization") or headers.get("Authorization") or ""
    if not raw.lower().startswith("basic "):
        return False
    try:
        decoded = base64.b64decode(raw[6:]).decode()
    except Exception:
        return False
    user, _, password = decoded.partition(":")
    return hmac.compare_digest(user, USERNAME) and hmac.compare_digest(password, PASSWORD)


def handler(event, context):
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}

    if not _authorised(headers):
        return {"statusCode": 401, "body": json.dumps({"error": "unauthorised"})}

    body = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode("utf-8", "replace")

    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return {"statusCode": 400, "body": json.dumps({"error": "body is not JSON"})}

    # Postmark's MessageID is the idempotency key. Webhooks are retried on any
    # non-2xx, and without keying on it a slow response becomes two itineraries.
    message_id = payload.get("MessageID") or hashlib.sha256(body.encode()).hexdigest()[:32]
    received = datetime.now(timezone.utc)
    key = f"inbound/{received:%Y/%m/%d}/{message_id}.json"

    stored = False
    if BUCKET:
        try:
            s3.put_object(
                Bucket=BUCKET,
                Key=key,
                Body=body.encode(),
                ContentType="application/json",
                Metadata={
                    "from": (payload.get("From") or "")[:120],
                    "subject": (payload.get("Subject") or "")[:200],
                },
            )
            stored = True
        except Exception as exc:  # noqa: BLE001 — report, never drop the mail
            print(f"s3 put failed for {key}: {exc}")

    # 200 even when S3 failed: Postmark retries on failure, and a retry storm
    # against a broken bucket helps nobody. The log carries the real outcome.
    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(
            {
                "received": True,
                "message_id": message_id,
                "stored": stored,
                "key": key if stored else None,
                "attachments": len(payload.get("Attachments") or []),
                "subject": payload.get("Subject", ""),
            }
        ),
    }
