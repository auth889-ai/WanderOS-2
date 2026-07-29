"""Full Travel Autopilot run on REAL files — the honest end-to-end proof.

Builds a genuine trip out of three source types (photos, a booking PDF, a voice
note), then drives every stage the product claims:

  extract evidence -> classify claims -> consent gate -> generate scenes with a
  critic loop -> compose -> seal into B2 Object Lock -> verify -> tamper-check

Nothing is stubbed. The PDF is a real PDF, the voice note is real synthesized
speech, the classification is a real model call, the film is really generated.

Run from media-worker:  PIPELINE_TIER=dev python3 scripts/end_to_end_demo.py
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, ".")

from app.config.settings import settings  # noqa: E402

WORK = Path(tempfile.mkdtemp(prefix="wanderos-e2e-"))
PHOTOS = Path("../public/images/traveler-dashboard")
STEP = 0


def step(title: str) -> None:
    global STEP
    STEP += 1
    print(f"\n{'=' * 74}\n  STEP {STEP} — {title}\n{'=' * 74}")


# ── Build a real trip ────────────────────────────────────────────────────────
step("Build a real trip: 3 photos + a booking PDF + a voice note")

itinerary_pdf = WORK / "itinerary.pdf"
lines = [
    "BALI TRIP CONFIRMATION - Wanderlust Tours",
    "Traveller: E. Ferdouse    Booking: WT-40182",
    "",
    "Day 1  09:15  Arrival, Ngurah Rai International",
    "Day 1  14:00  Check-in, Alila Seminyak",
    "Day 2  10:30  Beach morning, Seminyak",
    "Day 2  18:30  Sunset viewing at Uluwatu Temple",
    "Day 2  20:00  Seafood dinner at Jimbaran Bay",
    "Day 3  11:00  Departure transfer",
]
try:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas as pdfcanvas

    c = pdfcanvas.Canvas(str(itinerary_pdf), pagesize=A4)
    y = 780
    for ln in lines:
        c.setFont("Helvetica-Bold" if ln.startswith("BALI") else "Helvetica", 13 if ln.startswith("BALI") else 11)
        c.drawString(60, y, ln)
        y -= 22
    c.save()
except ImportError:
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "reportlab"], check=False)
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas as pdfcanvas

    c = pdfcanvas.Canvas(str(itinerary_pdf), pagesize=A4)
    y = 780
    for ln in lines:
        c.drawString(60, y, ln)
        y -= 22
    c.save()
print(f"  itinerary.pdf   {itinerary_pdf.stat().st_size:,} bytes (real PDF)")

# A real voice note — synthesized so it is genuine audio, not a fixture string.
voice = WORK / "voice-note.mp3"
import boto3  # noqa: E402

polly = boto3.Session(
    aws_access_key_id=settings.aws_access_key_id,
    aws_secret_access_key=settings.aws_secret_access_key,
    region_name=settings.aws_region,
).client("polly")
voice.write_bytes(polly.synthesize_speech(
    Text=("The beach was incredible today, we spent the whole afternoon swimming. "
          "Later we did make it up to the temple for the sunset."),
    OutputFormat="mp3", VoiceId="Joanna", Engine="neural",
)["AudioStream"].read())
print(f"  voice-note.mp3  {voice.stat().st_size:,} bytes (real audio, AWS Polly)")

photos = []
for name in ["city.jpg", "m4.png", "m7.png"]:
    src = PHOTOS / name
    if src.exists():
        dst = WORK / name
        shutil.copy(src, dst)
        photos.append(dst)
print(f"  photos          {len(photos)} real image files")


def as_url(p: Path) -> str:
    """Data URL — keeps the run self-contained and independent of presigning."""
    import base64
    import mimetypes

    mime = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
    return f"data:{mime};base64,{base64.b64encode(p.read_bytes()).decode()}"


assets = (
    [{"key": p.name, "kind": "photo", "url": as_url(p)} for p in photos]
    + [{"key": "itinerary.pdf", "kind": "document", "url": as_url(itinerary_pdf)}]
    + [{"key": "voice-note.mp3", "kind": "voice", "url": as_url(voice)}]
)

# ── Evidence ─────────────────────────────────────────────────────────────────
step("Extract evidence from all three source types")
from app.evidence.extractors import extract_all  # noqa: E402

bundle = extract_all(assets, job_id="e2e")
for group in ("documents", "voice", "photos"):
    for item in bundle[group]:
        if item.get("available"):
            detail = (item.get("text") or "")[:70].replace("\n", " ")
            if group == "photos":
                detail = ", ".join(l["name"] for l in item.get("labels", [])[:5])
            print(f"  [{group:9s}] {item['key']:16s} via {item['source']:20s} {detail}")
        else:
            print(f"  [{group:9s}] {item['key']:16s} UNAVAILABLE — {item.get('reason')}")
print(f"  sources used: {bundle['sources_used']}")

# ── Truth model ──────────────────────────────────────────────────────────────
step("Classify every claim by what the evidence actually proves")
from app.evidence.truth import apply_consent, classify, consent_questions, may_generate  # noqa: E402

result = classify(bundle)
print(f"  classifier: {result['classifier']}\n")
for c in result["claims"]:
    print(f"  [{c['status']:14s}] {int(c.get('confidence', 0) * 100):3d}%  {c['text'][:62]}")

questions = consent_questions(result["claims"])
print(f"\n  {len(questions)} moment(s) need the traveller's confirmation:")
for q in questions:
    print(f"    ? {q['question'][:110]}")

before = [c["id"] for c in result["claims"] if may_generate(c)]
print(f"\n  generatable BEFORE consent: {before}   <- the gate")

# ── Consent ──────────────────────────────────────────────────────────────────
step("Traveller answers: confirms the sunset, denies the rest")
decisions = {q["id"]: ("confirmed" if "sunset" in q["text"].lower() or "temple" in q["text"].lower()
                       else "denied") for q in questions}
for cid, d in decisions.items():
    print(f"  {cid:34s} -> {d}")
claims = apply_consent(result["claims"], decisions)
after = [c["id"] for c in claims if may_generate(c)]
print(f"\n  generatable AFTER consent : {after}   <- only what was confirmed")

# ── Generation + critic + seal ───────────────────────────────────────────────
step("Generate, critique, compose, seal")
confirmed = [c for c in claims if may_generate(c)]
storyboard = {
    "title": "Three Days in Bali",
    "narrationFull": ("We landed with the sunrise. The beach held the whole afternoon. "
                      "And the sunset we almost missed."),
    "scenes": [
        {"idx": 0, "source": "original", "assetKey": None, "motionPrompt": "arrival",
         "narrationLine": "We landed with the sunrise.", "durationSec": 3, "needsConsent": False},
        {"idx": 1, "source": "parallax", "assetKey": None, "motionPrompt": "the beach afternoon",
         "narrationLine": "The beach held the whole afternoon.", "durationSec": 4, "needsConsent": False},
    ],
}
if confirmed:
    storyboard["scenes"].append({
        "idx": 2, "source": "synthetic_scene", "assetKey": None,
        "genPrompt": "golden sunset over a Balinese clifftop temple, cinematic, warm light",
        "motionPrompt": "slow pan at sunset",
        "narrationLine": "And the sunset we almost missed.",
        "durationSec": 4, "needsConsent": True,
    })

from app.jobs.render_job import get_job, start_render  # noqa: E402

start_render("e2e-demo", "trip-e2e", storyboard, consents={"2": bool(confirmed)})
job = {}
for _ in range(180):
    time.sleep(2)
    job = get_job("e2e-demo") or {}
    if job.get("status") in ("delivered", "failed"):
        break
print(f"  render status: {job.get('status')}")
if job.get("status") != "delivered":
    print(f"  error: {job.get('error')}")
    sys.exit(1)

for s in job.get("scenes", []):
    attempts = s.get("attempts", [])
    label = (f"{len(attempts)} attempt(s), last {attempts[-1]['decision']} "
             f"@ {attempts[-1]['overall']} by {attempts[-1]['critic']}") if attempts else "no generation (real media)"
    print(f"  scene {s['idx']}: {label}")
print(f"  sealed to : {job.get('stored')}")
print(f"  retention : {job.get('publish_record', {}).get('retention', 'n/a')}")

# ── Verify + tamper ──────────────────────────────────────────────────────────
step("Verify the sealed film, then prove tampering is detected")
from app.trust.sealing import verify_film  # noqa: E402

record = job["publish_record"]
sealed = Path(record["sealed_path"])
good = verify_film(sealed, record)
for name, chk in good["checks"].items():
    print(f"  [{'PASS' if chk['pass'] else 'FAIL'}] {name:18s} {chk['detail'][:64]}")

tampered = WORK / "tampered.mp4"
data = bytearray(sealed.read_bytes())
data[len(data) // 2] ^= 0xFF
tampered.write_bytes(bytes(data))
bad = verify_film(tampered, record)
print(f"\n  one byte flipped -> verified = {bad['verified']}")
print(f"  {bad['checks']['file_hash']['detail'][:88]}")

print(f"\n{'=' * 74}")
print(f"  RESULT: {'PASS' if good['verified'] and not bad['verified'] else 'FAIL'} — "
      f"real film sealed and tamper-evident")
print(f"  film: {sealed}")
print(f"{'=' * 74}\n")
