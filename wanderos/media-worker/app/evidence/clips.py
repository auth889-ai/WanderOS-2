"""Video clip evidence — uploaded clips were being ignored entirely.

Travellers upload video alongside photos, and until now those files reached B2
and stopped there: no timeline entry, no evidence, no scene material. A 40-second
clip of the beach is often the single best footage of a trip, and we were
discarding it while paying a model to invent something similar.

PySceneDetect (BSD-3) splits a clip into shots by content change, so a long
handheld video becomes several usable scenes with a representative frame each.
Those frames then flow through the same vision path as photos — the clip becomes
evidence rather than an attachment.

Real footage is always preferable to generated footage: it is free, it is
accurate, and it needs no consent gate because it actually happened.
"""
from __future__ import annotations

import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

# Below this a "shot" is a camera wobble, not a scene worth cutting to.
MIN_SHOT_SECONDS = 1.2
# Cap per clip so one long video cannot dominate the storyboard.
MAX_SHOTS_PER_CLIP = 8


@dataclass
class Shot:
    index: int
    start_sec: float
    end_sec: float
    frame_path: Path | None = None

    @property
    def duration(self) -> float:
        return round(self.end_sec - self.start_sec, 2)


@dataclass
class ClipEvidence:
    key: str
    duration_sec: float = 0.0
    shots: list[Shot] = field(default_factory=list)
    available: bool = True
    reason: str = ""

    def summary(self) -> dict:
        return {
            "key": self.key,
            "available": self.available,
            "reason": self.reason,
            "duration_sec": self.duration_sec,
            "shots": [
                {"index": s.index, "start": s.start_sec, "end": s.end_sec,
                 "duration": s.duration, "frame": str(s.frame_path) if s.frame_path else None}
                for s in self.shots
            ],
        }


def _probe_duration(path: Path) -> float:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, timeout=60, check=True,
        )
        return round(float(out.stdout.strip()), 2)
    except Exception:
        return 0.0


def detect_shots(path: Path, *, work_dir: Path | None = None) -> ClipEvidence:
    """Split a clip into shots and grab a representative frame from each."""
    path = Path(path)
    evidence = ClipEvidence(key=path.name, duration_sec=_probe_duration(path))
    work = Path(work_dir or tempfile.mkdtemp(prefix="wanderos-clip-"))
    work.mkdir(parents=True, exist_ok=True)

    try:
        from scenedetect import ContentDetector, detect

        scenes = detect(str(path), ContentDetector())
    except Exception as exc:
        # A clip we cannot analyse is still a clip — treat the whole thing as one
        # shot rather than dropping the traveller's footage.
        evidence.reason = f"shot detection unavailable ({type(exc).__name__}); treating as one shot"
        scenes = []

    if not scenes and evidence.duration_sec > 0:
        evidence.shots = [Shot(index=0, start_sec=0.0, end_sec=evidence.duration_sec)]
    else:
        for i, (start, end) in enumerate(scenes):
            shot = Shot(index=i, start_sec=round(start.get_seconds(), 2),
                        end_sec=round(end.get_seconds(), 2))
            if shot.duration >= MIN_SHOT_SECONDS:
                evidence.shots.append(shot)
        evidence.shots = evidence.shots[:MAX_SHOTS_PER_CLIP]

    for shot in evidence.shots:
        # Sample a third of the way in: the first frame of a cut is often a
        # motion-blurred transition, the middle is the stable part of the shot.
        at = shot.start_sec + shot.duration / 3
        frame = work / f"{path.stem}-shot{shot.index:02d}.jpg"
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{at:.2f}",
                 "-i", str(path), "-frames:v", "1", "-q:v", "3", str(frame)],
                capture_output=True, timeout=90, check=True,
            )
            if frame.exists() and frame.stat().st_size > 0:
                shot.frame_path = frame
        except Exception:
            continue  # a missing frame loses one shot, not the clip

    if not evidence.shots:
        evidence.available = False
        evidence.reason = evidence.reason or "no usable shots found"
    return evidence


def best_shots(evidence: ClipEvidence, limit: int = 3) -> list[Shot]:
    """Longest shots first — duration is the cheapest available proxy for a
    stable, deliberate piece of footage rather than an accidental pan."""
    return sorted(
        [s for s in evidence.shots if s.frame_path],
        key=lambda s: s.duration,
        reverse=True,
    )[:limit]
