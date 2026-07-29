"""Multi-modal evidence extraction — every capability has a path that works today.

EXIF timestamps alone cannot tell you whether the traveler actually watched the
sunset. Three sources answer three different questions:

  documents  booking PDFs / itineraries -> the trip as *planned*
  voice      voice notes                -> the trip as *remembered*
  photos     photo content              -> the trip as *photographed*

Planned-but-not-photographed is exactly the gap the consent flow exists for, and
you cannot detect it without reading all three.

Each extractor is a chain, in the same spirit as the provider chain: the first
route that works serves, and the route that served is recorded. Crucially the
LAST route of the document chain is local (pypdf) — so evidence extraction never
depends on a cloud entitlement being granted.

  documents  pypdf (local, always)      -> AWS Textract (richer, when granted)
  voice      OpenAI Whisper             -> AWS Transcribe
  photos     OpenAI vision              -> AWS Rekognition
"""
from __future__ import annotations

import io
import json
import time
import urllib.request
from functools import lru_cache
from typing import Any

from app.config.settings import settings


@lru_cache(maxsize=8)
def _aws(service: str, region: str | None = None):
    import boto3

    return boto3.Session(
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
        region_name=region or settings.aws_region,
    ).client(service)


@lru_cache(maxsize=1)
def _openai():
    from openai import OpenAI

    return OpenAI(api_key=settings.openai_api_key)


def _fetch(url: str, limit: int = 25_000_000) -> bytes | None:
    try:
        if url.startswith("data:"):
            import base64

            return base64.b64decode(url.split(",", 1)[1])
        with urllib.request.urlopen(url, timeout=120) as r:
            return r.read(limit)
    except Exception:
        return None


def _fail(reason: str) -> dict[str, Any]:
    return {"available": False, "reason": reason[:200]}


# ── Documents: the trip as planned ──────────────────────────────────────────

def read_document(url: str) -> dict[str, Any]:
    """Local pypdf first — no entitlement, no network, no cost. Textract adds
    layout/forms for scans, so it is tried only when pypdf yields nothing."""
    data = _fetch(url)
    if data is None:
        return _fail("document unreachable")

    if data[:5] == b"%PDF-":
        try:
            import pypdf

            reader = pypdf.PdfReader(io.BytesIO(data))
            pages = [(p.extract_text() or "").strip() for p in reader.pages]
            lines = [ln.strip() for page in pages for ln in page.splitlines() if ln.strip()]
            if lines:
                return {"available": True, "source": "pypdf (local)", "lines": lines,
                        "pages": len(pages), "text": "\n".join(lines)[:20000]}
        except Exception:
            pass  # fall through to Textract for scanned/image PDFs

    try:
        blocks = _aws("textract").detect_document_text(Document={"Bytes": data})["Blocks"]
        lines = [b["Text"] for b in blocks if b["BlockType"] == "LINE" and b.get("Text")]
        return {"available": True, "source": "aws-textract", "lines": lines,
                "text": "\n".join(lines)[:20000]}
    except Exception as exc:
        return _fail(f"no text extracted (pypdf empty; textract: {type(exc).__name__})")


# ── Voice: the trip as remembered ───────────────────────────────────────────

def transcribe_voice(url: str, *, job_name: str) -> dict[str, Any]:
    """OpenAI Whisper first: one synchronous call, no S3 staging required.
    AWS Transcribe is the fallback and needs a staging bucket."""
    data = _fetch(url)
    if data is None:
        return _fail("voice note unreachable")

    if settings.openai_api_key:
        try:
            buf = io.BytesIO(data)
            buf.name = f"{job_name}.mp3"
            result = _openai().audio.transcriptions.create(model="whisper-1", file=buf)
            return {"available": True, "source": "openai-whisper", "text": result.text[:20000]}
        except Exception:
            pass

    bucket = settings.aws_staging_bucket
    if not bucket:
        return _fail("whisper unavailable and no S3 staging bucket for Transcribe")
    try:
        key = f"voice/{job_name}.mp3"
        _aws("s3").put_object(Bucket=bucket, Key=key, Body=data)
        _aws("transcribe").start_transcription_job(
            TranscriptionJobName=job_name,
            Media={"MediaFileUri": f"s3://{bucket}/{key}"},
            MediaFormat="mp3", IdentifyLanguage=True,
        )
    except Exception as exc:
        return _fail(f"transcribe start failed: {type(exc).__name__}")

    deadline = time.monotonic() + 300
    while time.monotonic() < deadline:
        try:
            job = _aws("transcribe").get_transcription_job(
                TranscriptionJobName=job_name)["TranscriptionJob"]
        except Exception as exc:
            return _fail(f"transcribe poll failed: {type(exc).__name__}")
        status = job["TranscriptionJobStatus"]
        if status == "COMPLETED":
            body = _fetch(job["Transcript"]["TranscriptFileUri"])
            if body is None:
                return _fail("transcript unreachable")
            payload = json.loads(body)
            return {"available": True, "source": "aws-transcribe",
                    "text": payload["results"]["transcripts"][0]["transcript"][:20000]}
        if status == "FAILED":
            return _fail(job.get("FailureReason", "transcription failed"))
        time.sleep(5)
    return _fail("transcription timed out")


# ── Photos: the trip as photographed ────────────────────────────────────────

_VISION_PROMPT = (
    "List what this travel photo actually shows, as JSON: "
    '{"labels":[{"name":"...","confidence":0-100}],"people":<count>,'
    '"setting":"...","time_of_day":"morning|midday|afternoon|sunset|night|unknown"}. '
    "Only describe what is visibly present. Do not guess a location you cannot see."
)


def label_photo(url: str) -> dict[str, Any]:
    """OpenAI vision first — richer than label detection (it reads setting and
    time of day, which is what gap detection actually needs)."""
    if settings.openai_api_key:
        try:
            response = _openai().chat.completions.create(
                model="gpt-4o-mini",
                max_tokens=400,
                response_format={"type": "json_object"},
                messages=[{"role": "user", "content": [
                    {"type": "text", "text": _VISION_PROMPT},
                    {"type": "image_url", "image_url": {"url": url}},
                ]}],
            )
            payload = json.loads(response.choices[0].message.content)
            return {"available": True, "source": "openai-vision",
                    "labels": payload.get("labels", [])[:20],
                    "people": payload.get("people", 0),
                    "setting": payload.get("setting"),
                    "time_of_day": payload.get("time_of_day")}
        except Exception:
            pass

    data = _fetch(url, limit=5_000_000)
    if data is None:
        return _fail("photo unreachable")
    try:
        rk = _aws("rekognition")
        labels = rk.detect_labels(Image={"Bytes": data}, MaxLabels=20, MinConfidence=75.0)["Labels"]
        faces = rk.detect_faces(Image={"Bytes": data})["FaceDetails"]
        return {"available": True, "source": "aws-rekognition",
                "labels": [{"name": l["Name"], "confidence": round(l["Confidence"], 1)}
                           for l in labels],
                "people": len(faces)}
    except Exception as exc:
        return _fail(f"no vision route (openai failed; rekognition: {type(exc).__name__})")


def extract_all(assets: list[dict], *, job_id: str) -> dict[str, Any]:
    """Run the right extractor per asset kind. Partial-tolerant by design.

    ``assets`` items: {"key": str, "url": str, "kind": "photo"|"document"|"voice"}
    """
    bundle: dict[str, Any] = {"documents": [], "voice": [], "photos": [], "degraded": []}
    for i, asset in enumerate(assets):
        kind, url, key = asset.get("kind"), asset.get("url"), asset.get("key", f"asset-{i}")
        if not url:
            continue
        if kind == "document":
            result, target = read_document(url), bundle["documents"]
        elif kind == "voice":
            result, target = transcribe_voice(url, job_name=f"{job_id}-{i}"), bundle["voice"]
        else:
            result, target = label_photo(url), bundle["photos"]
        result["key"] = key
        target.append(result)
        if not result.get("available"):
            bundle["degraded"].append({"key": key, "kind": kind, "reason": result.get("reason")})
    bundle["complete"] = not bundle["degraded"]
    bundle["sources_used"] = sorted({
        r["source"] for group in ("documents", "voice", "photos")
        for r in bundle[group] if r.get("available")
    })
    return bundle
