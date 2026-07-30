"""High-quality camera motion on stills — the Ken Burns path, done properly.

The previous implementation visibly shook. Two causes, both classic ffmpeg
`zoompan` traps:

**1. Accumulated rounding.** `z='min(zoom+0.0008,1.25)'` builds the zoom by
adding to the PREVIOUS frame's value. zoompan stores that at limited precision
and recomputes the crop origin as integers each frame, so the error compounds
and the frame jitters. Deriving zoom from the absolute output frame number
(`on`) instead makes every frame independent of the last — no drift, no shake.

**2. Not enough supersampling.** Scaling a photo to 2560x1440 and zooming to
1280x720 gives only 2x headroom, so the integer crop origin snaps a full
half-pixel at output scale — clearly visible on a slow push. Working at 4x the
output and downscaling with lanczos puts that snap at a quarter pixel, below
what the eye tracks on a moving frame.

Beyond fixing the shake, real camera moves ease. A linear zoom reads as
mechanical; starting and ending slow is what makes it feel photographed rather
than computed, so the motion runs through a smoothstep curve.
"""
from __future__ import annotations

import random
from pathlib import Path

from app.media.ffmpeg import run_ffmpeg

# Working resolution as a multiple of output. 4x kills the jitter; 8x is
# indistinguishable from 4x and costs far more memory on large photos.
SUPERSAMPLE = 4
# How far a push-in travels. Beyond ~1.2 a photo starts to look soft.
DEFAULT_ZOOM = 1.14
# Cinematic default. 24 shows judder on slow pans; 30 is smooth and cheap.
DEFAULT_FPS = 30
# x264 quality. 18 is visually lossless for this material; the default 23 is
# where the mush comes from.
DEFAULT_CRF = 18
DEFAULT_PRESET = "slow"


def _smoothstep(progress: str) -> str:
    """Smoothstep easing as an ffmpeg expression: 3t² − 2t³.

    Eases in and out, so the move starts and settles gently instead of
    snapping to a constant velocity the moment the clip begins.
    """
    return f"(3*pow({progress},2)-2*pow({progress},3))"


def ken_burns(
    photo: Path,
    out: Path,
    *,
    seconds: float,
    width: int = 1920,
    height: int = 1080,
    fps: int = DEFAULT_FPS,
    direction: str | None = None,
    zoom: float = DEFAULT_ZOOM,
    crf: int = DEFAULT_CRF,
    preset: str = DEFAULT_PRESET,
    seed: int | None = None,
) -> Path:
    """Render a still as a smooth, eased camera move.

    `direction` picks the move; None chooses one deterministically from `seed`
    so a rerun of the same job produces the same film, while consecutive scenes
    still differ from each other. A whole film of identical push-ins is the
    other way this looks cheap.
    """
    moves = ("in", "out", "left", "right", "up", "down")
    if direction is None:
        direction = random.Random(seed).choice(moves)

    frames = max(2, int(round(seconds * fps)))
    work_w, work_h = width * SUPERSAMPLE, height * SUPERSAMPLE

    # Absolute frame number -> 0..1, then eased. Never accumulative.
    t = f"(on/{frames - 1})"
    eased = _smoothstep(t)

    if direction == "in":
        z = f"(1+{zoom - 1:.4f}*{eased})"
        x, y = "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"
    elif direction == "out":
        z = f"({zoom:.4f}-{zoom - 1:.4f}*{eased})"
        x, y = "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"
    else:
        # A pan holds a constant zoom and slides the window, so there is room to
        # travel without leaving the frame.
        z = f"{zoom:.4f}"
        span_x = f"(iw-iw/zoom)"
        span_y = f"(ih-ih/zoom)"
        if direction == "left":
            x, y = f"{span_x}*(1-{eased})", "ih/2-(ih/zoom/2)"
        elif direction == "right":
            x, y = f"{span_x}*{eased}", "ih/2-(ih/zoom/2)"
        elif direction == "up":
            x, y = "iw/2-(iw/zoom/2)", f"{span_y}*(1-{eased})"
        else:
            x, y = "iw/2-(iw/zoom/2)", f"{span_y}*{eased}"

    graph = (
        # Cover the frame at working resolution, then crop to exact size so
        # zoompan sees a clean canvas with no letterboxing.
        f"scale={work_w}:{work_h}:force_original_aspect_ratio=increase:flags=lanczos,"
        f"crop={work_w}:{work_h},"
        f"zoompan=z='{z}':x='{x}':y='{y}':d={frames}:s={width}x{height}:fps={fps},"
        # Downscale from the supersampled render; lanczos is what keeps detail.
        f"scale={width}:{height}:flags=lanczos,"
        f"format=yuv420p"
    )

    run_ffmpeg(
        ["-loop", "1", "-i", str(photo), "-vf", graph, "-t", f"{seconds}",
         "-c:v", "libx264", "-crf", str(crf), "-preset", preset,
         "-profile:v", "high", "-level", "4.2",
         "-movflags", "+faststart", str(out)],
        stage=f"ken-burns-{direction}", timeout=600,
    )
    return out


def still(photo: Path, out: Path, *, seconds: float, width: int = 1920,
          height: int = 1080, fps: int = DEFAULT_FPS, crf: int = DEFAULT_CRF) -> Path:
    """A held frame, for material that should not move (a map, a document)."""
    run_ffmpeg(
        ["-loop", "1", "-i", str(photo),
         "-vf", (f"scale={width}:{height}:force_original_aspect_ratio=decrease:flags=lanczos,"
                 f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p"),
         "-t", f"{seconds}", "-r", str(fps),
         "-c:v", "libx264", "-crf", str(crf), "-preset", DEFAULT_PRESET,
         "-movflags", "+faststart", str(out)],
        stage="still", timeout=300,
    )
    return out


def crossfade(clips: list[Path], out: Path, *, duration: float = 0.6,
              fps: int = DEFAULT_FPS, width: int = 1920, height: int = 1080,
              crf: int = DEFAULT_CRF) -> Path:
    """Join clips with dissolves instead of hard cuts.

    Hard cuts between still-derived scenes are what make a slideshow read as a
    slideshow. `xfade` needs each transition offset expressed against the
    running total, so the offsets are accumulated rather than taken per clip —
    getting that wrong silently drops clips from the end of the film.
    """
    from app.media.ffmpeg import probe_duration

    if len(clips) == 1:
        return clips[0]

    durations = [probe_duration(c) for c in clips]
    inputs: list[str] = []
    for clip in clips:
        inputs += ["-i", str(clip)]

    # Normalise every input first: xfade requires identical size, fps and format.
    steps = [f"[{i}:v]scale={width}:{height}:flags=lanczos,fps={fps},format=yuv420p[v{i}]"
             for i in range(len(clips))]

    current = "[v0]"
    running = durations[0]
    for i in range(1, len(clips)):
        offset = max(0.0, running - duration)
        label = f"[x{i}]" if i < len(clips) - 1 else "[vout]"
        steps.append(f"{current}[v{i}]xfade=transition=fade:duration={duration}"
                     f":offset={offset:.3f}{label}")
        current = label
        # Each dissolve overlaps, so the film is shorter than the sum of clips.
        running = running + durations[i] - duration

    run_ffmpeg(
        [*inputs, "-filter_complex", ";".join(steps), "-map", "[vout]",
         "-c:v", "libx264", "-crf", str(crf), "-preset", DEFAULT_PRESET,
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out)],
        stage="crossfade", timeout=900,
    )
    return out
