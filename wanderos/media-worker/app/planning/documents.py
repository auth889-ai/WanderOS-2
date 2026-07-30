"""Read travel documents from photos and PDFs into checkable fields.

The Readiness Vault could tell you a passport breaks the six-month rule — but
only if someone had already typed the expiry date in. That is the part travellers
never do, and it is the part that makes the whole feature worthless: nobody
manually transcribes a passport to find out it is fine.

This closes the loop. A photo of a passport page or a booking PDF goes in;
structured fields come out and flow straight into `check_readiness`.

**Why the existing vision model rather than an OCR engine.** Tesseract and
PaddleOCR return text, and the hard part here is not reading characters — it is
knowing that "07 FEB 2027" on a passport is the expiry and "12 MAR 2017" is the
issue date, on a layout that differs by country. A vision model does that
directly. Adding an OCR dependency would give us worse structure and a heavier
image.

**Nothing here is trusted blindly.** Every field carries a confidence, dates are
re-parsed and validated in code rather than accepted as the model wrote them, and
anything doubtful is surfaced for the traveller to confirm. This feeds a feature
that can stop someone boarding a flight, so a hallucinated expiry date is worse
than no date at all.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import date, datetime

from app.planning.readiness import Document

logger = logging.getLogger(__name__)

EXTRACTION_PROMPT = """Extract the fields from this travel document as JSON.
Read ONLY what is printed. If a field is absent or unreadable, use null — never
guess, and never infer a date from another date.

{"doc_type": "passport|visa|booking|insurance|vaccination|prescription|licence|id_card|unknown",
 "holder_name": "full name exactly as printed, or null",
 "number": "document or booking number, or null",
 "issued": "YYYY-MM-DD or null",
 "expires": "YYYY-MM-DD or null",
 "issuing_country": "ISO-2 code or null",
 "reference": "booking reference / PNR, or null",
 "baggage_allowance": "as printed, or null",
 "confidence": 0.0-1.0,
 "unreadable_fields": ["names of fields you could not read"]}

Dates: passports print expiry as "DATE OF EXPIRY". Do not confuse it with
"DATE OF ISSUE". If both are present, return both. If you cannot tell which is
which, return null for both and list them in unreadable_fields."""

# A document that looks like a passport but has no expiry is more dangerous than
# one we failed to read at all, so extraction confidence is floored below this.
MIN_TRUSTED_CONFIDENCE = 0.55

# Passing a schema makes complete() return PARSED fields. Without it the call
# succeeds and returns {"text": "```json ..."} — the model had read the passport
# correctly at 0.95 confidence and every field was being thrown away one layer up.
DOC_SCHEMA = {
    "type": "object",
    "properties": {
        "doc_type": {"type": "string"},
        "holder_name": {"type": ["string", "null"]},
        "number": {"type": ["string", "null"]},
        "issued": {"type": ["string", "null"]},
        "expires": {"type": ["string", "null"]},
        "issuing_country": {"type": ["string", "null"]},
        "reference": {"type": ["string", "null"]},
        "baggage_allowance": {"type": ["string", "null"]},
        "confidence": {"type": "number"},
        "unreadable_fields": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["doc_type", "confidence"],
}


def _parse_date(value) -> date | None:
    """Parse a date the model returned, tolerating common formats.

    Re-parsed in code rather than trusted: a model that writes "2027-02-30"
    produces a plausible-looking string that is not a date, and downstream this
    would silently become a passport that never expires.
    """
    if not value or not isinstance(value, str):
        return None
    text = value.strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d %b %Y", "%d %B %Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    match = re.search(r"(\d{4})-(\d{2})-(\d{2})", text)
    if match:
        try:
            return date(*(int(g) for g in match.groups()))
        except ValueError:
            return None
    return None


def _sane(parsed: date | None, *, field: str, today: date | None = None) -> date | None:
    """Reject dates that cannot be real for this field."""
    if parsed is None:
        return None
    today = today or date.today()
    if field == "expires" and not (today.year - 1 <= parsed.year <= today.year + 25):
        logger.warning("implausible expiry %s discarded", parsed)
        return None
    if field == "issued" and not (today.year - 60 <= parsed.year <= today.year + 1):
        logger.warning("implausible issue date %s discarded", parsed)
        return None
    return parsed


def read_document_image(image_bytes: bytes, *, today: date | None = None) -> Document:
    """Extract fields from a photo of a document."""
    from app.reasoning.claude import complete

    try:
        # complete() takes the image as a keyword and returns PARSED json.
        # describe() takes no arguments and returns the model name — calling it
        # with arguments raised, was swallowed, and produced an empty document.
        payload = complete(EXTRACTION_PROMPT, image_jpeg=image_bytes,
                           schema=DOC_SCHEMA, max_tokens=800)
    except Exception as exc:
        logger.warning("document extraction failed: %s", exc)
        return Document(kind="unknown", source_confidence=0.0,
                        raw_text=f"extraction failed: {type(exc).__name__}")

    confidence = float(payload.get("confidence") or 0.0)
    unreadable = payload.get("unreadable_fields") or []
    # Fields are dropped rather than kept at low confidence: check_readiness
    # already reports a missing expiry as something to confirm, which is the
    # right outcome. A wrong expiry silently passes the six-month check.
    trusted = confidence >= MIN_TRUSTED_CONFIDENCE

    return Document(
        kind=(payload.get("doc_type") or "unknown"),
        holder_name=(payload.get("holder_name") or "") if trusted else "",
        number=(payload.get("number") or "") if trusted else "",
        issued=_sane(_parse_date(payload.get("issued")), field="issued", today=today) if trusted else None,
        expires=_sane(_parse_date(payload.get("expires")), field="expires", today=today) if trusted else None,
        issuing_country=(payload.get("issuing_country") or ""),
        reference=(payload.get("reference") or ""),
        baggage_allowance=(payload.get("baggage_allowance") or ""),
        source_confidence=confidence,
        raw_text=("unreadable: " + ", ".join(unreadable)) if unreadable else "",
    )


def read_document_pdf(pdf_bytes: bytes, *, today: date | None = None) -> Document:
    """Extract fields from a booking or insurance PDF.

    Text is pulled locally with pypdf first — a booking confirmation is real text,
    not a picture of text, so sending it to a vision model would be slower, more
    expensive and less accurate.
    """
    import io

    text = ""
    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(pdf_bytes))
        text = "\n".join((page.extract_text() or "") for page in reader.pages[:5])
    except Exception as exc:
        logger.warning("pdf text extraction failed: %s", exc)

    if not text.strip():
        return Document(kind="unknown", source_confidence=0.0,
                        raw_text="no extractable text (a scanned PDF needs the image path)")

    from app.reasoning.claude import complete

    try:
        payload = complete(
            f"{EXTRACTION_PROMPT}\n\nDocument text:\n{text[:6000]}",
            schema=DOC_SCHEMA, max_tokens=800,
        )
    except Exception as exc:
        logger.warning("pdf field extraction failed: %s", exc)
        return Document(kind="unknown", source_confidence=0.0, raw_text=text[:500])

    confidence = float(payload.get("confidence") or 0.0)
    trusted = confidence >= MIN_TRUSTED_CONFIDENCE
    return Document(
        kind=(payload.get("doc_type") or "booking"),
        holder_name=(payload.get("holder_name") or "") if trusted else "",
        number=(payload.get("number") or ""),
        issued=_sane(_parse_date(payload.get("issued")), field="issued", today=today) if trusted else None,
        expires=_sane(_parse_date(payload.get("expires")), field="expires", today=today) if trusted else None,
        issuing_country=(payload.get("issuing_country") or ""),
        reference=(payload.get("reference") or ""),
        baggage_allowance=(payload.get("baggage_allowance") or ""),
        source_confidence=confidence,
        raw_text=text[:500],
    )
