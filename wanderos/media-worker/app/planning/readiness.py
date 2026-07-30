"""Feature 13 — Documents and Readiness Vault.

The failures this catches all happen at a counter, hours before departure, when
nothing can be done: a passport four months from expiry against a six-month
rule, a ticket booked as "Eva Ferdouse" against a passport reading
"Jannatul Ferdouse", an insurance policy that lapsed the week before.

**The hard rule in this module: it never decides a legal question.**

Visa and entry requirements change without notice, differ by nationality,
destination, purpose, layover and passport type, and getting one wrong strands
someone in a foreign airport. So nothing here returns "you need a visa" or "you
do not". It returns *what to check, with whom, and by when* — and every
requirement carries its jurisdiction, source, retrieval date and an explicit
`human_review_required` flag.

That is a deliberate product decision, not a limitation to be engineered away
later. An AI that confidently says "no visa needed" and is wrong has done more
damage than one that says nothing at all.

The date arithmetic, by contrast, IS decidable and is done exactly: expiry
against the six-month rule is a subtraction, and a model has no business being
involved in it.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, timedelta

# Most countries require a passport valid this far beyond the date you LEAVE.
# The near-universal trap: travellers check it against the outbound date.
PASSPORT_VALIDITY_MONTHS = 6
# Windows for warning before it becomes unfixable. A renewal takes weeks.
EXPIRY_WARN_DAYS = 270

DOC_TYPES = ("passport", "visa", "booking", "insurance", "vaccination",
             "prescription", "licence", "id_card")


@dataclass
class Document:
    kind: str
    holder_name: str = ""
    number: str = ""
    issued: date | None = None
    expires: date | None = None
    issuing_country: str = ""
    reference: str = ""
    baggage_allowance: str = ""
    raw_text: str = ""
    source_confidence: float = 1.0   # 1.0 = typed by the traveller, lower = OCR


@dataclass
class Finding:
    code: str
    severity: str            # blocking | warning | check
    subject: str
    detail: str
    action: str = ""
    deadline: str = ""
    # Populated only for legal/entry matters. Their presence is the signal that
    # this is NOT a determination.
    jurisdiction: str = ""
    source: str = ""
    retrieved: str = ""
    human_review_required: bool = False

    def as_dict(self) -> dict:
        return dict(self.__dict__)


def _normalise_name(name: str) -> list[str]:
    """Comparable name tokens.

    Deliberately loose: case, punctuation, and ordering vary between a passport
    MRZ and an airline booking, and flagging every such difference as a mismatch
    would train people to ignore the warning that matters.
    """
    cleaned = re.sub(r"[^a-z\s]", " ", name.lower())
    return sorted(t for t in cleaned.split() if len(t) > 1)


def name_mismatch(passport_name: str, booking_name: str) -> tuple[bool, str]:
    """True when the names differ in a way an airline is likely to reject."""
    p, b = _normalise_name(passport_name), _normalise_name(booking_name)
    if not p or not b:
        return False, "one of the names is missing"
    if p == b:
        return False, "names match"
    shared = set(p) & set(b)
    # A missing middle name is normal and rarely refused; a different surname or
    # a completely different name is what strands people.
    if shared and (set(p) <= set(b) or set(b) <= set(p)):
        return False, f"one name has extra parts ({sorted(set(p) ^ set(b))}) — usually accepted"
    if not shared:
        return True, "no name parts in common"
    return True, f"names differ: passport {p} vs booking {b}"


def check_readiness(
    documents: list[Document],
    *,
    departure: date,
    return_date: date | None = None,
    destination_country: str = "",
    nationality: str = "",
    today: date | None = None,
) -> dict:
    """Everything checkable about a traveller's paperwork, ranked by severity."""
    today = today or date.today()
    findings: list[Finding] = []
    by_kind = {d.kind: d for d in documents}

    # --- Passport: pure arithmetic, decided here ---
    passport = by_kind.get("passport")
    if passport is None:
        findings.append(Finding(
            "passport_missing", "blocking", "passport",
            "no passport on file, so nothing about it can be checked",
            "add your passport to the vault"))
    elif passport.expires is None:
        findings.append(Finding(
            "passport_expiry_unknown", "warning", "passport",
            "passport is on file but its expiry date was not captured",
            "confirm the expiry date"))
    else:
        anchor = return_date or departure
        required_until = anchor + timedelta(days=PASSPORT_VALIDITY_MONTHS * 30)
        days_left = (passport.expires - anchor).days
        if passport.expires <= anchor:
            findings.append(Finding(
                "passport_expired", "blocking", "passport",
                f"expires {passport.expires} — before you return on {anchor}",
                "renew before travelling", deadline=str(departure)))
        elif passport.expires < required_until:
            findings.append(Finding(
                "passport_six_month_rule", "blocking", "passport",
                f"expires {passport.expires}, only {days_left} days after you return "
                f"({anchor}). Most destinations require {PASSPORT_VALIDITY_MONTHS} months' "
                f"validity beyond your stay, i.e. until {required_until}",
                "renew now — this is the most common reason people are refused boarding",
                deadline=str(departure),
                jurisdiction=destination_country or "destination",
                human_review_required=True,
                source="confirm the exact rule with the destination's consulate"))
        elif (passport.expires - today).days < EXPIRY_WARN_DAYS:
            findings.append(Finding(
                "passport_expiring_soon", "warning", "passport",
                f"expires {passport.expires}; fine for this trip but renewal takes weeks",
                "renew after you return"))

    # --- Name consistency across passport and bookings ---
    booking = by_kind.get("booking")
    if passport and booking and passport.holder_name and booking.holder_name:
        mismatched, why = name_mismatch(passport.holder_name, booking.holder_name)
        if mismatched:
            findings.append(Finding(
                "name_mismatch", "blocking", "booking",
                f"{why}. Airlines refuse boarding when the ticket does not match the passport",
                "contact the airline to correct the name — some charge a fee and most "
                "will not allow it close to departure",
                deadline=str(departure - timedelta(days=1))))

    # --- Insurance ---
    insurance = by_kind.get("insurance")
    if insurance is None:
        findings.append(Finding(
            "insurance_missing", "warning", "insurance",
            "no travel insurance on file", "add a policy or confirm you are travelling without one"))
    elif insurance.expires and insurance.expires < (return_date or departure):
        findings.append(Finding(
            "insurance_lapses", "blocking", "insurance",
            f"policy ends {insurance.expires}, before you return on {return_date or departure}",
            "extend the policy to cover the whole trip"))

    # --- Prescriptions ---
    prescription = by_kind.get("prescription")
    if prescription and prescription.expires and prescription.expires < departure:
        findings.append(Finding(
            "prescription_expired", "warning", "prescription",
            f"prescription expired {prescription.expires}",
            "renew it — some countries require documentation for medication you carry"))

    # --- Low-confidence extraction ---
    for doc in documents:
        if doc.source_confidence < 0.75:
            findings.append(Finding(
                "low_ocr_confidence", "check", doc.kind,
                f"fields were read from an image with {doc.source_confidence:.0%} confidence",
                "check the extracted dates and names against the document itself"))

    # --- Entry requirements: NEVER decided here ---
    if destination_country:
        findings.append(Finding(
            "entry_requirements", "check", "visa / entry",
            f"entry rules for a {nationality or 'your'} passport travelling to "
            f"{destination_country} must be confirmed against an official source. "
            "Requirements depend on nationality, purpose, length of stay, layover "
            "countries and passport type, and they change without notice",
            "check the destination's official immigration site or consulate, and your "
            "airline's document requirements",
            deadline=str(departure - timedelta(days=30)),
            jurisdiction=destination_country,
            source="official government immigration authority",
            retrieved=str(today),
            human_review_required=True))

    order = {"blocking": 0, "warning": 1, "check": 2}
    findings.sort(key=lambda f: order.get(f.severity, 3))
    blocking = [f for f in findings if f.severity == "blocking"]
    return {
        "ready": not blocking,
        "days_to_departure": (departure - today).days,
        "findings": [f.as_dict() for f in findings],
        "blocking_count": len(blocking),
        "needs_human_review": [f.subject for f in findings if f.human_review_required],
        "documents_on_file": sorted(by_kind),
        "missing_document_types": [k for k in ("passport", "booking", "insurance")
                                   if k not in by_kind],
        "disclaimer": (
            "Date checks are exact. Entry and visa requirements are NOT determined here — "
            "they are surfaced for you to confirm with an official source."
        ),
    }
