"""Multi-modal evidence extraction — the layer that makes claims checkable.

EXIF timestamps alone cannot tell you whether the traveler actually watched the
sunset. Three AWS services turn the raw pile into facts a reasoner can weigh:

  Textract    booking PDFs / itineraries -> the trip as *planned*
  Transcribe  voice notes                -> the trip as *remembered*
  Rekognition photos                     -> the trip as *photographed*

Planned-but-not-photographed is exactly the gap the consent flow exists for, and
you cannot detect it without reading all three sources.

Every extractor degrades to ``available=False`` with the reason attached rather
than raising, so a locked-down AWS account produces an honest partial timeline
instead of a failed job.
"""
from __future__ import annotations

import json
import time
import urllib.request
from functools import lru_cache
from typing import Any

from app.config.settings import settings


@lru_cache(maxsize=8)
def _client(service: str, region: str | None = None):
    import boto3

    return boto3.Session(
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
        region_name=region or settings.aws_region,
    ).client(service)


def _fetch(url: str, limit: int = 12_000_000) -> bytes | None:
    try:
        with urllib.request.urlopen(url, timeout=120) as r:
            return r.read(limit)
    except Exception:
        return None


def _unavailable(reason: str) -> dict[str, Any]:
    return {"available": False, "reason": reason[:200]}


# ── Documents: the trip as planned ──────────────────────────────────────────

def read_document(url: str) -> dict[str, Any]:
    """Textract a booking PDF / itinerary image into lines of text."""
    data = _fetch(url)
    if data is None:
        return _unavailable("document unreachable")
    try:
        blocks = _client("textract").detect_document_text(Document={"Bytes": data})["Blocks"]
    except Exception as exc:
        return _unavailable(f"textract denied: {type(exc).__name__}")
    lines = [b["Text"] for b in blocks if b["BlockType"] == "LINE" and b.get("Text")]
    return {"available": True, "source": "aws-textract", "lines": lines,
            "text": "\n".join(lines)[:20000]}


# ── Voice: the trip as remembered ───────────────────────────────────────────

def transcribe_voice(url: str, *, job_name: str, bucket: str | None = None) -> dict[str, Any]:
    """Amazon Transcribe. Needs an S3 staging bucket — Transcribe reads from S3."""
    bucket = bucket or settings.aws_staging_bucket
    if not bucket:
        return _unavailable("no S3 staging bucket configured for Transcribe")
    data = _fetch(url)
    if data is None:
        return _unavailable("voice note unreachable")

    key = f"voice/{job_name}.mp3"
    try:
        _client("s3").put_object(Bucket=bucket, Key=key, Body=data)
        tr = _client("transcribe")
        tr.start_transcription_job(
            TranscriptionJobName=job_name,
            Media={"MediaFileUri": f"s3://{bucket}/{key}"},
            MediaFormat="mp3",
            IdentifyLanguage=True,
        )
    except Exception as exc:
        return _unavailable(f"transcribe start failed: {type(exc).__name__}")

    deadline = time.monotonic() + 300
    while time.monotonic() < deadline:
        try:
            job = _client("transcribe").get_transcription_job(
                TranscriptionJobName=job_name)["TranscriptionJob"]
        except Exception as exc:
            return _unavailable(f"transcribe poll failed: {type(exc).__name__}")
        status = job["TranscriptionJobStatus"]
        if status == "COMPLETED":
            body = _fetch(job["Transcript"]["TranscriptFileUri"])
            if body is None:
                return _unavailable("transcript unreachable")
            payload = json.loads(body)
            return {"available": True, "source": "aws-transcribe",
                    "text": payload["results"]["transcripts"][0]["transcript"][:20000],
                    "language": job.get("LanguageCode")}
        if status == "FAILED":
            return _unavailable(job.get("FailureReason", "transcription failed"))
        time.sleep(5)
    return _unavailable("transcription timed out")


# ── Photos: the trip as photographed ────────────────────────────────────────

def label_photo(url: str, *, min_confidence: float = 75.0) -> dict[str, Any]:
    """Rekognition labels + face count — what a photo can actually attest to."""
    data = _fetch(url, limit=5_000_000)
    if data is None:
        return _unavailable("photo unreachable")
    try:
        rk = _client("rekognition")
        labels = rk.detect_labels(Image={"Bytes": data}, MaxLabels=20,
                                  MinConfidence=min_confidence)["Labels"]
        faces = rk.detect_faces(Image={"Bytes": data})["FaceDetails"]
    except Exception as exc:
        return _unavailable(f"rekognition denied: {type(exc).__name__}")
    return {
        "available": True,
        "source": "aws-rekognition",
        "labels": [{"name": l["Name"], "confidence": round(l["Confidence"], 1)} for l in labels],
        "people": len(faces),
    }


def extract_all(assets: list[dict], *, job_id: str) -> dict[str, Any]:
    """Run the right extractor per asset kind. Returns a partial-tolerant bundle.

    ``assets`` items: {"key": str, "url": str, "kind": "photo"|"document"|"voice"}
    """
    bundle: dict[str, Any] = {"documents": [], "voice": [], "photos": [], "degraded": []}
    for i, asset in enumerate(assets):
        kind, url, key = asset.get("kind"), asset.get("url"), asset.get("key", f"asset-{i}")
        if not url:
            continue
        if kind == "document":
            result = read_document(url)
            bucket = bundle["documents"]
        elif kind == "voice":
            result = transcribe_voice(url, job_name=f"{job_id}-{i}")
            bucket = bundle["voice"]
        else:
            result = label_photo(url)
            bucket = bundle["photos"]
        result["key"] = key
        bucket.append(result)
        if not result.get("available"):
            bundle["degraded"].append({"key": key, "kind": kind, "reason": result.get("reason")})
    bundle["complete"] = not bundle["degraded"]
    return bundle
