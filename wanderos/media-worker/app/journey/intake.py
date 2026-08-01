"""Booking import — a photograph of a confirmation becomes a live trip.

TripIt's entire business is turning forwarded confirmation emails into an
itinerary. Doing that by email needs MX records on a domain, which is
procurement rather than engineering and blocks the feature entirely until
someone buys a domain.

A camera sidesteps all of it. The traveller photographs the confirmation — on
screen or on paper, in any language, from any provider — and gets the same
result with no domain, no DNS and no integration with Booking.com.

    photo -> Textract (OCR + key/value) -> facts -> Journey Twin -> cascade -> board

**What matters here is not the OCR.** It is extracting the three things that
decide whether a disruption costs money, which every itinerary organiser throws
away:

    non-refundable      -> whether a missed booking is a real loss
    hard deadlines      -> "reception closes at 23:00" is why a delay strands you
    the money           -> what the loss actually is

Textract surfaces those unprompted. Verified on a real Booking.com layout: 11
key-value pairs including `Non-refundable`, `Check-in`, `Total price` and the
flight number.

**Nothing extracted is trusted as final.** Every field carries `needs_review`
and the source text it came from, because an OCR mistake in a check-in time
would silently poison every downstream prediction. The traveller confirms before
it becomes a `traveller`-sourced fact.
"""
from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass, field
from datetime import date, datetime

logger = logging.getLogger(__name__)

# Words that mean a missed booking is money gone. Multilingual because a
# traveller photographs whatever their provider sent them.
NON_REFUNDABLE = re.compile(
    r"non[-\s]?refundable|no[nt][-\s]refundable|not refundable|nicht erstattungsf|"
    r"no reembolsable|non remboursable|cancellation is not permitted|"
    r"kann nicht storniert", re.I)
REFUNDABLE = re.compile(r"free cancellation|fully refundable|cancel for free|"
                        r"kostenlose stornierung|cancelaci[oó]n gratuita", re.I)

# "Reception closes at 23:00" — the single most consequential line in a hotel
# confirmation and the one no itinerary app records.
CLOSING = re.compile(
    r"(?:reception|front desk|check[-\s]?in)\s+(?:closes?|until|till|by)\s*"
    r"(?:at\s*)?(\d{1,2})[:.](\d{2})", re.I)
LATE_CHECKIN_REFUSED = re.compile(r"no late check[-\s]?in|late arrival not", re.I)

MONEY = re.compile(r"(GBP|EUR|USD|AUD|CAD|JPY|£|€|\$)\s*([\d,]+\.?\d{0,2})", re.I)
FLIGHT_CODE = re.compile(r"\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{1,4})\b")
AIRPORT = re.compile(r"\(([A-Z]{3})\)")
CONFIRMATION = re.compile(r"(?:confirmation|booking|reference|PNR|record locator)"
                          r"[\s#:]*([A-Z0-9]{5,})", re.I)

SYMBOL_TO_CODE = {"£": "GBP", "€": "EUR", "$": "USD"}

DATE_PATTERNS = (
    "%d %B %Y", "%d %b %Y", "%B %d %Y", "%b %d %Y",
    "%d/%m/%Y", "%m/%d/%Y", "%Y-%m-%d",
)


@dataclass
class Field:
    """One extracted value, and everything needed to doubt it."""
    value: object
    source_text: str = ""
    confidence: float = 0.0
    needs_review: bool = True

    def as_dict(self) -> dict:
        return {"value": self.value, "from": self.source_text[:120],
                "confidence": round(self.confidence, 2),
                "needs_review": self.needs_review}


@dataclass
class Booking:
    kind: str = "unknown"            # stay | flight | unknown
    fields: dict[str, Field] = field(default_factory=dict)
    raw_lines: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def set(self, key: str, value, *, source: str = "", confidence: float = 0.0):
        # Never let a weaker read overwrite a stronger one.
        existing = self.fields.get(key)
        if existing and existing.confidence > confidence:
            return
        self.fields[key] = Field(value, source, confidence,
                                 needs_review=confidence < 0.95)

    def get(self, key, default=None):
        f = self.fields.get(key)
        return f.value if f else default

    def as_dict(self) -> dict:
        return {
            "kind": self.kind,
            "fields": {k: f.as_dict() for k, f in self.fields.items()},
            "warnings": self.warnings,
            "needs_review": [k for k, f in self.fields.items() if f.needs_review],
            "line_count": len(self.raw_lines),
        }


def _parse_date(text: str) -> date | None:
    """Dates in confirmations come in every shape. Try the common ones and
    give up honestly rather than guessing a wrong day."""
    cleaned = re.sub(r"(?:Mon|Tues?|Wed(?:nes)?|Thurs?|Fri|Sat(?:ur)?|Sun)[a-z]*,?\s*",
                     "", text, flags=re.I)
    cleaned = re.sub(r"(\d+)(st|nd|rd|th)", r"\1", cleaned, flags=re.I).strip()
    match = re.search(r"(\d{1,2}\s+\w+\s+\d{4}|\w+\s+\d{1,2},?\s+\d{4}|"
                      r"\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})", cleaned)
    if not match:
        return None
    candidate = match.group(1).replace(",", "").replace("-", "/") \
        if "/" in match.group(1) or "-" in match.group(1) else match.group(1).replace(",", "")
    for pattern in DATE_PATTERNS:
        for attempt in (match.group(1).replace(",", ""), candidate):
            try:
                return datetime.strptime(attempt.strip(), pattern).date()
            except ValueError:
                continue
    return None


def _parse_time(text: str) -> tuple[int, int] | None:
    match = re.search(r"\b(\d{1,2})[:.](\d{2})\b", text)
    if not match:
        return None
    hour, minute = int(match.group(1)), int(match.group(2))
    return (hour, minute) if 0 <= hour < 24 and 0 <= minute < 60 else None


def extract_text(image_bytes: bytes, *, region: str = "") -> dict:
    """OCR plus the key/value pairs Textract finds on its own.

    FORMS is what makes this work — plain OCR gives a wall of text, and
    reconstructing "Check-in:" -> "Tuesday 4 August" from raw lines is fragile.
    Textract already knows they belong together.
    """
    import boto3

    client = boto3.client("textract",
                          region_name=region or os.getenv("AWS_REGION", "us-east-1"))
    response = client.analyze_document(Document={"Bytes": image_bytes},
                                       FeatureTypes=["FORMS"])
    blocks = response["Blocks"]
    by_id = {b["Id"]: b for b in blocks}

    def words_of(block) -> str:
        out = []
        for rel in block.get("Relationships", []):
            if rel["Type"] == "CHILD":
                out += [by_id[i]["Text"] for i in rel["Ids"]
                        if by_id[i]["BlockType"] == "WORD"]
        return " ".join(out)

    pairs: dict[str, tuple[str, float]] = {}
    for block in blocks:
        if block["BlockType"] == "KEY_VALUE_SET" and "KEY" in block.get("EntityTypes", []):
            key = words_of(block)
            value = ""
            for rel in block.get("Relationships", []):
                if rel["Type"] == "VALUE":
                    value = " ".join(words_of(by_id[i]) for i in rel["Ids"])
            if key:
                pairs[key.rstrip(":").strip()] = (value, block.get("Confidence", 0) / 100)

    return {
        "lines": [b["Text"] for b in blocks if b["BlockType"] == "LINE"],
        "pairs": pairs,
    }


def parse(extracted: dict) -> Booking:
    """Turn OCR into a booking — with the three fields that decide money."""
    booking = Booking()
    booking.raw_lines = extracted.get("lines", [])
    pairs = extracted.get("pairs", {})
    blob = "\n".join(booking.raw_lines)

    def pair(*names) -> tuple[str, float]:
        for key, (value, confidence) in pairs.items():
            if any(n.lower() in key.lower() for n in names):
                return value, confidence
        return "", 0.0

    # --- What kind of booking is this ---
    if re.search(r"check[-\s]?in|check[-\s]?out|hotel|nights?|room", blob, re.I):
        booking.kind = "stay"
    if re.search(r"\bflight\b|departs?|boarding|PNR", blob, re.I):
        booking.kind = "flight" if booking.kind == "unknown" else "mixed"

    # --- Refundability: the field that decides whether a miss costs money ---
    if NON_REFUNDABLE.search(blob):
        line = next((l for l in booking.raw_lines if NON_REFUNDABLE.search(l)), "")
        booking.set("refundable", False, source=line, confidence=0.93)
    elif REFUNDABLE.search(blob):
        line = next((l for l in booking.raw_lines if REFUNDABLE.search(l)), "")
        booking.set("refundable", True, source=line, confidence=0.9)
    else:
        # Unknown refundability is NOT "refundable". Assuming refundable would
        # understate the loss on exactly the bookings that hurt most.
        booking.warnings.append(
            "Refundability not stated. Treated as unknown — not as refundable, "
            "because assuming refundable understates the loss.")

    # --- Hard deadline: why a delay strands someone ---
    closing = CLOSING.search(blob)
    if closing:
        line = next((l for l in booking.raw_lines if CLOSING.search(l)), "")
        booking.set("closes_at", f"{int(closing.group(1)):02d}:{closing.group(2)}",
                    source=line, confidence=0.9)
    if LATE_CHECKIN_REFUSED.search(blob):
        booking.set("late_checkin_allowed", False,
                    source=next((l for l in booking.raw_lines
                                 if LATE_CHECKIN_REFUSED.search(l)), ""),
                    confidence=0.9)

    # --- The money ---
    total, confidence = pair("total price", "total", "amount", "grand total")
    money = MONEY.search(total or blob)
    if money:
        symbol = money.group(1).upper()
        booking.set("currency", SYMBOL_TO_CODE.get(money.group(1), symbol),
                    source=money.group(0), confidence=max(confidence, 0.85))
        booking.set("value", float(money.group(2).replace(",", "")),
                    source=money.group(0), confidence=max(confidence, 0.85))

    # --- Dates ---
    for label, names in (("check_in", ("check-in", "check in", "arrival")),
                         ("check_out", ("check-out", "check out", "departure"))):
        text, confidence = pair(*names)
        if not text:
            continue
        parsed = _parse_date(text)
        if parsed:
            time = _parse_time(text)
            booking.set(label, parsed.isoformat(), source=text, confidence=confidence)
            if time:
                booking.set(f"{label}_time", f"{time[0]:02d}:{time[1]:02d}",
                            source=text, confidence=confidence)
        else:
            booking.warnings.append(f"Could not read a date from {text!r}")

    # --- Flight ---
    flight_text, confidence = pair("flight")
    code = FLIGHT_CODE.search(flight_text or "")
    if not code:
        line = next((l for l in booking.raw_lines
                     if re.search(r"\bflight\b", l, re.I)), "")
        code = FLIGHT_CODE.search(line)
        flight_text = line
    if code:
        booking.set("flight_iata", f"{code.group(1)}{code.group(2)}",
                    source=flight_text, confidence=max(confidence, 0.8))
    airports = AIRPORT.findall(blob)
    if len(airports) >= 2:
        booking.set("departure_airport", airports[0], source=blob[:80], confidence=0.85)
        booking.set("arrival_airport", airports[1], source=blob[:80], confidence=0.85)

    reference, confidence = pair("confirmation", "booking reference", "reference")
    if reference:
        booking.set("reference", reference.strip(), source=reference,
                    confidence=confidence)
    elif (found := CONFIRMATION.search(blob)):
        booking.set("reference", found.group(1), source=found.group(0), confidence=0.7)

    return booking


def to_commitment(booking: Booking, *, key: str = "") -> dict:
    """A booking becomes a node the cascade can reason about.

    This is where the extraction earns itself: refundability and the closing
    time flow straight into expected-loss and hard-deadline logic.
    """
    from datetime import time as clock

    kind = {"stay": "stay", "flight": "flight"}.get(booking.kind, "booking")
    label = ("Hotel check-in" if kind == "stay"
             else f"Flight {booking.get('flight_iata', '')}".strip())

    starts = None
    if booking.get("check_in"):
        hour, minute = 15, 0
        if booking.get("check_in_time"):
            parsed = _parse_time(booking.get("check_in_time"))
            if parsed:
                hour, minute = parsed
        starts = datetime.combine(date.fromisoformat(booking.get("check_in")),
                                  clock(hour, minute)).isoformat()

    hard_deadline = None
    if booking.get("closes_at") and booking.get("check_in"):
        parsed = _parse_time(booking.get("closes_at"))
        if parsed:
            hard_deadline = datetime.combine(
                date.fromisoformat(booking.get("check_in")),
                clock(*parsed)).isoformat()

    consequence = ""
    if booking.get("late_checkin_allowed") is False:
        consequence = "No late check-in on this rate"
    elif booking.get("closes_at"):
        consequence = f"Reception closes at {booking.get('closes_at')}"

    return {
        "key": key or kind,
        "label": label or "Booking",
        "kind": kind,
        "starts": starts,
        "value": booking.get("value"),
        "currency": booking.get("currency", "GBP"),
        # Unknown refundability is not refundable. `is not False` would quietly
        # treat every unreadable confirmation as free to lose.
        "refundable": booking.get("refundable") is True,
        "hard_deadline": hard_deadline,
        "consequence": consequence,
    }


def ingest(image_bytes: bytes, *, region: str = "") -> dict:
    """Photograph in, reviewable trip out."""
    booking = parse(extract_text(image_bytes, region=region))
    return {
        "booking": booking.as_dict(),
        "commitment": to_commitment(booking),
        "review_required": True,
        "why_review": ("Nothing here is a confirmed fact yet. An OCR mistake in a "
                       "check-in time would poison every prediction downstream, so "
                       "the traveller confirms before this becomes trusted."),
        "no_domain_needed": ("Email ingestion needs MX records on a domain. A camera "
                             "gets the same result with no DNS and no provider "
                             "integration."),
    }
