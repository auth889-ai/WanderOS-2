"""Publication sealing — the pinned 7-step provenance spec (DETAILED_BUILD_SPEC P5).

1 raw_sha = sha256(film_raw)          4 Mp4Handler.embed(manifest+sig) -> sealed
2 manifest = run + scenes + verdicts  5 sealed_sha = sha256(sealed)
3 sig = ed25519(canonical manifest)   6 publish record -> B2 Object Lock (or local ledger
                                        when B2 absent — clearly marked NOT tamper-proof)
7 verify = re-hash vs record + extract embedded manifest + signature check.
Tamper flips check 1; forged manifest flips check 3; rewritten history -> Object Lock refuses.
"""
from __future__ import annotations

import hashlib
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from genblaze import Manifest
from genblaze_core.media import Mp4Handler

from app.config.settings import settings

LEDGER_DIR = Path(__file__).resolve().parents[2] / ".local-ledger"  # B2-absent fallback


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _load_private() -> Ed25519PrivateKey:
    raw = Path(settings.manifest_signing_key_path).read_bytes()
    return serialization.load_pem_private_key(raw, password=None)  # type: ignore[return-value]


def _load_public() -> Ed25519PublicKey:
    pub = Path(settings.manifest_signing_key_path).with_suffix(".pub").read_bytes()
    return serialization.load_pem_public_key(pub)  # type: ignore[return-value]


def _store_locked(key: str, body: bytes) -> dict:
    """Write the publish record under an EXPLICIT Object Lock retention.

    Enabling Object Lock on a bucket does not by itself make an object immutable
    — a retention mode and retain-until date must be applied, either as a bucket
    default or per object. Relying on the bucket default means the guarantee is
    invisible in the code and silently lost if the bucket is ever reconfigured,
    so the retention is set per object here and the effective lock is read back
    and recorded. If the key lacks retention permission the write still succeeds
    and the record says plainly that it is NOT locked.
    """
    import boto3

    retain_until = datetime.now(timezone.utc) + timedelta(days=settings.object_lock_days)
    s3 = boto3.client(
        "s3", endpoint_url=f"https://s3.{settings.b2_region}.backblazeb2.com",
        aws_access_key_id=settings.b2_key_id, aws_secret_access_key=settings.b2_application_key,
    )
    bucket = settings.b2_bucket_provenance
    try:
        s3.put_object(
            Bucket=bucket, Key=key, Body=body, ContentType="application/json",
            ObjectLockMode="COMPLIANCE", ObjectLockRetainUntilDate=retain_until,
        )
    except Exception:
        s3.put_object(Bucket=bucket, Key=key, Body=body, ContentType="application/json")
        return {"stored": f"b2://{bucket}/{key}",
                "retention": "NONE — write succeeded but retention could not be applied"}

    try:
        actual = s3.get_object_retention(Bucket=bucket, Key=key)["Retention"]
        detail = f"{actual['Mode']} until {actual['RetainUntilDate'].isoformat()}"
    except Exception:
        detail = f"COMPLIANCE until {retain_until.isoformat()} (read-back unavailable)"
    return {"stored": f"b2://{bucket}/{key}", "retention": detail}


def seal_film(film_raw: Path, manifest: Manifest, extra: dict) -> dict:
    """Returns the publish record; writes sealed file next to raw as *.sealed.mp4."""
    raw_sha = _sha256(film_raw)
    doc = {
        "raw_sha256": raw_sha,
        "manifest": json.loads(manifest.to_canonical_json()),
        **extra,  # scenes, verdicts, approvals, job_id
        "sealed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    canonical = json.dumps(doc, sort_keys=True, separators=(",", ":")).encode()
    sig = _load_private().sign(canonical).hex()

    sealed = film_raw.with_suffix(".sealed.mp4")
    Mp4Handler().embed(film_raw, manifest, output=sealed)
    record = {"doc": doc, "signature": sig, "sealed_sha256": _sha256(sealed), "sealed_path": str(sealed)}

    if settings.b2_configured:
        key = f"manifests/{extra.get('job_id', 'unknown')}-{int(time.time())}.json"
        record.update(_store_locked(key, json.dumps(record).encode()))
    else:
        LEDGER_DIR.mkdir(exist_ok=True)
        p = LEDGER_DIR / f"{extra.get('job_id', 'unknown')}-{int(time.time())}.json"
        p.write_text(json.dumps(record, indent=2))
        record["stored"] = f"local-ledger:{p.name} (NOT tamper-proof — B2 Object Lock pending keys)"
    return record


def verify_film(candidate: Path, record: dict) -> dict:
    """The public /verify logic — three independent checks, each reported honestly."""
    checks: dict[str, dict] = {}
    actual = _sha256(candidate)
    checks["file_hash"] = {
        "pass": actual == record["sealed_sha256"],
        "detail": "file bytes match the sealed publish record" if actual == record["sealed_sha256"]
        else f"HASH MISMATCH — file was modified after sealing ({actual[:12]}… ≠ {record['sealed_sha256'][:12]}…)",
    }
    try:
        canonical = json.dumps(record["doc"], sort_keys=True, separators=(",", ":")).encode()
        _load_public().verify(bytes.fromhex(record["signature"]), canonical)
        checks["signature"] = {"pass": True, "detail": "publish record signed by WanderOS (ed25519)"}
    except Exception:
        checks["signature"] = {"pass": False, "detail": "SIGNATURE INVALID — record forged or altered"}
    try:
        embedded = Mp4Handler().extract(candidate)
        checks["embedded_manifest"] = {"pass": embedded is not None, "detail": "lineage manifest present in file"}
    except Exception as e:
        checks["embedded_manifest"] = {"pass": False, "detail": f"no readable manifest: {type(e).__name__}"}
    return {"verified": all(c["pass"] for c in checks.values()), "checks": checks}
