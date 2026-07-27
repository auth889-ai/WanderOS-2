"""Day-1 spike — proves the entire WanderOS Autopilot engine shape on the real Genblaze SDK.

Runs with ZERO api keys (Mock providers). Proves:
  1. Multi-step Pipeline (image -> video -> audio) with chaining + step events (live view feed)
  2. AgentLoop critic: evaluate -> retry -> accept (the hackathon's core ask)
  3. Provenance: Manifest.from_run -> Mp4Handler.embed -> extract -> verify
  4. Tamper test: flip one byte -> verification FAILS (the demo money moment)

Usage:  .venv/bin/python spike.py
"""
from __future__ import annotations

import hashlib
import shutil
import subprocess
import tempfile
from pathlib import Path

from genblaze import (
    AgentLoop,
    Asset,
    LoggingTracer,
    Manifest,
    MockAudioProvider,
    MockProvider,
    MockVideoProvider,
    Modality,
    Pipeline,
    ThresholdEvaluator,
)
from genblaze_core.media import Mp4Handler

WORK = Path(tempfile.mkdtemp(prefix="wanderos-spike-"))
PASS, FAIL = "\033[32mPASS\033[0m", "\033[31mFAIL\033[0m"
results: list[tuple[str, bool]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok))
    print(f"  [{PASS if ok else FAIL}] {name}" + (f" — {detail}" if detail else ""))


def make_real_mp4(path: Path) -> Path:
    """A real 2s test-pattern MP4 so manifest embedding works on genuine media."""
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
         "-i", "testsrc=duration=2:size=640x360:rate=24", "-pix_fmt", "yuv420p", str(path)],
        check=True,
    )
    return path


def mock_asset(step, kind: str) -> list[Asset]:
    data = f"{kind}-{step.model}".encode()
    return [Asset(
        asset_id=f"{kind}-asset",
        url=f"file://{WORK}/{kind}.bin",
        media_type={"image": "image/png", "video": "video/mp4", "audio": "audio/mp3"}[kind],
        sha256=hashlib.sha256(data).hexdigest(),
        size_bytes=len(data),
    )]


# ---------------------------------------------------------------- 1. pipeline + events
print("\n== 1. Multi-step pipeline with live step events ==")
events: list[str] = []

def on_step(ev):  # the exact hook the Live Pipeline View will consume
    name = getattr(ev, "step_type", None) or getattr(ev, "model", "?")
    events.append(str(name))
    print(f"     event -> step complete: {getattr(ev, 'model', ev)}")

pipe = (
    Pipeline("spike-listing-film", tenant_id="trip-demo", chain=True, tracer=LoggingTracer())
    .step(MockProvider(name="mock-image", assets=lambda s: mock_asset(s, "image")),
          model="mock-enhance-v1", prompt="enhance beach photo", modality=Modality.IMAGE)
    .step(MockVideoProvider(name="mock-video", assets=lambda s: mock_asset(s, "video")),
          model="mock-kling-v2", fallback_models=["mock-seedance"],
          prompt="cinematic dolly over the beach", modality=Modality.VIDEO)
    .step(MockAudioProvider(name="mock-tts", assets=lambda s: mock_asset(s, "audio")),
          model="mock-tts-v1", prompt="Warm narration: seven days in Bali", modality=Modality.AUDIO)
)
result = pipe.run(on_step_complete=on_step)
run = getattr(result, "run", result)
check("3-step chained pipeline ran", len(getattr(run, "steps", [])) == 3)
check("step-complete events fired (live-view feed)", len(events) == 3)

# ---------------------------------------------------------------- 2. AgentLoop critic
print("\n== 2. AgentLoop critic: reject -> retry -> accept ==")
attempts = {"n": 0}

def factory(ctx):
    attempts["n"] += 1
    feedback = ctx.last_evaluation.feedback if ctx.last_evaluation else None
    return Pipeline(f"scene-attempt-{attempts['n']}", chain=True).step(
        MockVideoProvider(name="mock-video", assets=lambda s: mock_asset(s, "video")),
        model=f"mock-model-attempt{attempts['n']}",
        prompt=(feedback or "first try: sunset scene"), modality=Modality.VIDEO)

# scores 0.62 on attempt 1 (reject), 0.91 on attempt 2 (accept) — same policy as production
critic = ThresholdEvaluator(
    score_fn=lambda res: 0.62 if attempts["n"] == 1 else 0.91,
    threshold=0.85,
    feedback_fn=lambda res, score: f"score {score}: horizon warped — re-prompt with stable camera",
)
loop_result = AgentLoop(factory, critic, max_iterations=3).run()
check("critic rejected attempt 1, accepted attempt 2", attempts["n"] == 2,
      f"iterations={attempts['n']}")

# ---------------------------------------------------------------- 3. provenance
print("\n== 3. Provenance: manifest -> embed into real MP4 -> extract -> verify ==")
manifest = Manifest.from_run(run)
mp4 = make_real_mp4(WORK / "promo.mp4")
sealed = Mp4Handler().embed(mp4, manifest, output=WORK / "promo.sealed.mp4")
extracted = Mp4Handler().extract(sealed)
check("manifest embedded into MP4", sealed.exists(), f"{sealed.stat().st_size} bytes")
check("manifest extracted back from MP4", extracted is not None)
check("manifest hash verification", bool(extracted.verify_hash()) if hasattr(extracted, "verify_hash") else extracted.verify())

# ---------------------------------------------------------------- 4. tamper test
# Production design (last/2.md): at publish time we store sha256(sealed_file) + the manifest
# in the B2 Object Lock bucket. /verify re-downloads, re-hashes, compares. The manifest inside
# the file proves lineage; the Object Lock record proves the bytes are untouched.
print("\n== 4. Tamper test: publish record vs re-hash -> must FAIL on tampered file ==")
object_lock_record = hashlib.sha256(sealed.read_bytes()).hexdigest()  # what B2 Object Lock holds

tampered = WORK / "promo.tampered.mp4"
shutil.copy(sealed, tampered)
data = bytearray(tampered.read_bytes())
data[len(data) // 2] ^= 0xFF
tampered.write_bytes(bytes(data))

check("original file verifies against publish record",
      hashlib.sha256(sealed.read_bytes()).hexdigest() == object_lock_record)
check("tampered file DETECTED (hash mismatch vs publish record)",
      hashlib.sha256(tampered.read_bytes()).hexdigest() != object_lock_record)
check("lineage manifest still extractable from tampered file (shows what it claimed to be)",
      Mp4Handler().extract(tampered) is not None)

# ---------------------------------------------------------------- summary
print("\n== SPIKE SUMMARY ==")
ok = all(p for _, p in results)
for name, p in results:
    print(f"  {'✅' if p else '❌'} {name}")
print(f"\n{'🏆 ALL GREEN — the engine design works on the real SDK.' if ok else '❌ Fix before proceeding.'}")
print(f"workdir: {WORK}")
raise SystemExit(0 if ok else 1)
