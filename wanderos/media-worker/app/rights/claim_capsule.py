"""Claim Capsule — a disruption claim as a sealed, verifiable evidence bundle.

Claims fail on evidence, not on entitlement. By the time a traveller gets round
to claiming, the boarding pass is lost, the receipts are gone, nobody wrote down
what the gate agent said, and the screenshot of the departure board has no
provenance. The airline asks for proof and the claim quietly dies.

This is the same machinery the film uses, pointed at a different problem: gather
what happened, hash it, sign it, and write it under Object Lock so the record
cannot be edited afterwards — including by us. The value is not that WanderOS
says the flight was five hours late; it is that the record was sealed at the
time, and anyone can verify the bytes have not changed since.

Deliberate limits, because overclaiming here would be dishonest:
- Sealing proves WHEN a record was made and that it has not changed SINCE. It
  does not prove the contents were true when written. The capsule states this
  in its own text so nobody reads more into it than it supports.
- Evidence the traveller supplies is labelled as theirs. Evidence we computed is
  labelled as ours. A claims handler needs to know which is which.
"""
from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.rights.passenger_rights import DISCLAIMER, Flight, assess

# What a claims handler will ask for, per disruption type. Listing what is
# MISSING is the useful half: a capsule that says "no boarding pass" tells the
# traveller what to find while they still can.
EXPECTED_EVIDENCE = {
    "delay": ["boarding_pass", "booking_confirmation", "departure_board_photo", "expense_receipts"],
    "cancellation": ["booking_confirmation", "cancellation_notice", "rebooking_confirmation",
                     "expense_receipts"],
    "denied_boarding": ["boarding_pass", "booking_confirmation", "denied_boarding_notice"],
    "baggage": ["baggage_tag", "property_irregularity_report", "contents_list", "purchase_receipts"],
}


@dataclass
class EvidenceItem:
    kind: str
    origin: str            # "traveller" | "wanderos" | "carrier"
    sha256: str
    size_bytes: int
    b2_key: str | None = None
    note: str = ""

    def as_dict(self) -> dict:
        return dict(self.__dict__)


@dataclass
class Capsule:
    claim_id: str
    assessment: dict
    evidence: list[EvidenceItem] = field(default_factory=list)
    missing_evidence: list[str] = field(default_factory=list)
    sealed: dict | None = None

    def as_dict(self) -> dict:
        return {
            "claim_id": self.claim_id,
            "assessment": self.assessment,
            "evidence": [e.as_dict() for e in self.evidence],
            "missing_evidence": self.missing_evidence,
            "sealed": self.sealed,
        }


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _upload(claim_id: str, kind: str, data: bytes, content_type: str) -> str | None:
    from app.config.settings import settings

    if not settings.b2_configured:
        return None
    try:
        from app.media import pipelines

        key = f"claims/{claim_id}/{kind}-{_sha256_bytes(data)[:12]}"
        pipelines._backend().put(key, data, content_type=content_type)
        return key
    except Exception:
        # Losing a copy must not lose the claim; the hash is already recorded, so
        # the traveller's own file still verifies against the sealed capsule.
        return None


def build_capsule(
    claim_id: str,
    flight: Flight,
    *,
    evidence_files: list[dict[str, Any]] | None = None,
    baggage: dict[str, Any] | None = None,
) -> Capsule:
    """Assess entitlements, hash and store the evidence, and list what is missing.

    `evidence_files`: [{kind, origin, data: bytes, content_type?, note?}]
    """
    assessment = assess(flight, baggage=baggage)
    items: list[EvidenceItem] = []

    for f in evidence_files or []:
        data: bytes = f["data"]
        kind = f.get("kind", "unknown")
        items.append(EvidenceItem(
            kind=kind,
            origin=f.get("origin", "traveller"),
            sha256=_sha256_bytes(data),
            size_bytes=len(data),
            b2_key=_upload(claim_id, kind, data, f.get("content_type", "application/octet-stream")),
            note=f.get("note", ""),
        ))

    # Our own computed assessment is itself evidence, and is labelled as ours so
    # a handler never mistakes a calculation for a document.
    assessment_bytes = json.dumps(assessment, sort_keys=True, default=str).encode()
    items.append(EvidenceItem(
        kind="entitlement_assessment", origin="wanderos",
        sha256=_sha256_bytes(assessment_bytes), size_bytes=len(assessment_bytes),
        b2_key=_upload(claim_id, "assessment", assessment_bytes, "application/json"),
        note="computed by WanderOS from the flight record; not a document from the carrier"))

    disruption = "baggage" if baggage else flight.disruption
    have = {i.kind for i in items}
    missing = [k for k in EXPECTED_EVIDENCE.get(disruption, []) if k not in have]
    return Capsule(claim_id=claim_id, assessment=assessment, evidence=items,
                   missing_evidence=missing)


def seal_capsule(capsule: Capsule) -> dict:
    """Sign the capsule and write it under Object Lock.

    Reuses the film's signing key and the same COMPLIANCE-locked bucket, so a
    claim record and a published film carry the same guarantee and verify with
    the same public key.
    """
    from cryptography.hazmat.primitives import serialization  # noqa: F401  (parity with sealing)

    from app.config.settings import settings
    from app.trust.sealing import _load_private, _store_locked

    doc = {
        **capsule.as_dict(),
        "sealed_at": datetime.now(timezone.utc).isoformat(),
        "attestation": (
            "This record was sealed at the time shown and has not been altered since. "
            "Sealing proves integrity and timing; it does not by itself prove the "
            "contents were accurate when written."
        ),
        "disclaimer": DISCLAIMER,
    }
    canonical = json.dumps(doc, sort_keys=True, separators=(",", ":"), default=str).encode()
    signature = _load_private().sign(canonical).hex()
    record = {"doc": doc, "signature": signature,
              "canonical_sha256": _sha256_bytes(canonical)}

    if settings.b2_configured:
        key = f"claims/{capsule.claim_id}-{int(time.time())}.json"
        record.update(_store_locked(key, json.dumps(record, default=str).encode()))
    else:
        record["stored"] = "local only — B2 not configured, so this record is NOT tamper-proof"
    capsule.sealed = record
    return record


def verify_capsule(record: dict) -> dict:
    """Re-derive the signature over the canonical document."""
    from cryptography.exceptions import InvalidSignature

    from app.trust.sealing import _load_public

    checks: dict[str, bool] = {}
    canonical = json.dumps(record["doc"], sort_keys=True, separators=(",", ":"),
                           default=str).encode()
    checks["canonical_sha256"] = _sha256_bytes(canonical) == record.get("canonical_sha256")
    try:
        _load_public().verify(bytes.fromhex(record["signature"]), canonical)
        checks["signature"] = True
    except (InvalidSignature, ValueError, KeyError):
        checks["signature"] = False
    return {"verified": all(checks.values()), "checks": checks}
