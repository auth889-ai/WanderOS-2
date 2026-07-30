"""The single adapter for ffmpeg/ffprobe. Nothing else shells out to them.

Before this existed, three modules each invoked ffmpeg their own way and reached
across package boundaries to borrow each other's private helpers — `pack.py`
imported `_run_ffmpeg` from `compose.py`, `clips.py` grew its own duplicate
duration probe. Underscore-prefixed names crossing a package boundary means the
boundary is decorative, so this module gives the capability a public home.

Everything here takes plain paths and returns plain values: no job, no
storyboard, no provider. That is what makes it testable without a pipeline.
"""
from __future__ import annotations

import logging
import re
import subprocess
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)


class FFmpegError(RuntimeError):
    """An ffmpeg invocation failed. Carries the stage so logs say which one."""

    def __init__(self, stage: str, stderr: str):
        self.stage = stage
        self.stderr = stderr
        super().__init__(f"ffmpeg {stage} failed: {stderr.strip()[:400]}")


def run_ffmpeg(args: list[str], *, stage: str, timeout: int = 300) -> None:
    """Invoke ffmpeg with the flags every call in this codebase wants."""
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args],
            capture_output=True, text=True, timeout=timeout, check=True,
        )
    except subprocess.CalledProcessError as exc:
        raise FFmpegError(stage, exc.stderr or "") from exc
    except subprocess.TimeoutExpired as exc:
        raise FFmpegError(stage, f"timed out after {timeout}s") from exc


def probe_duration(path: Path) -> float:
    """Seconds of media at `path`, or 0.0 if it cannot be read.

    Returns 0.0 rather than raising: a duration we cannot read should degrade
    the scene, not abort a film the traveller has already waited on.
    """
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, timeout=60, check=True,
        )
        return round(float(out.stdout.strip()), 3)
    except Exception:
        return 0.0


@lru_cache(maxsize=1)
def available_filters() -> frozenset[str]:
    """Filter names this ffmpeg build registers, parsed from `-filters`.

    Burning captions needs the `subtitles` filter, which only exists when ffmpeg
    was built --enable-libass. Plenty of builds omit it, so we probe rather than
    assume. `ffmpeg -h filter=<name>` is NOT a usable probe: it exits 0 even for
    filters that do not exist.
    """
    try:
        out = subprocess.run(
            ["ffmpeg", "-hide_banner", "-filters"],
            capture_output=True, text=True, timeout=15, check=True,
        ).stdout
    except Exception as exc:
        logger.warning("ffmpeg -filters probe failed: %s", exc)
        return frozenset()
    # Each line: " <flags(3)> <name> <in->out> <desc>"; flags are T/S/C or '.'.
    return frozenset(
        m.group(1)
        for line in out.splitlines()
        if (m := re.match(r"\s*[TSC.]{3}\s+(\S+)\s", line))
    )


def has_filter(name: str) -> bool:
    return name in available_filters()
