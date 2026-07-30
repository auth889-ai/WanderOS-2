"""Captions, in both forms a film needs.

Two different jobs, often confused:

**Burned-in** captions are pixels. They survive every player, every download and
every re-upload to a platform that strips metadata — which matters because most
social video is watched with the sound off. We render them with Pillow and
composite with ffmpeg `overlay`, deliberately NOT `drawtext`/`subtitles`: those
need libass, minimal ffmpeg builds omit it, and a caption that disappears on a
container rebuild is worse than one that is slightly less pretty.

**A sidecar/soft track** is text. It is what a screen reader, a search index and
a viewer who wants to turn captions off all need. Burned pixels serve none of
them. Shipping only burned captions makes the film inaccessible; shipping only a
soft track makes it silent-unfriendly. So we ship both.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

_FONT_CANDIDATES = (
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
)


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in _FONT_CANDIDATES:
        try:
            return ImageFont.truetype(candidate, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _wrap(text: str, draw: ImageDraw.ImageDraw, fnt, max_width: int) -> list[str]:
    """Greedy wrap to pixel width. A caption wider than the frame is cropped by
    ffmpeg's overlay, so the end of a long line would silently vanish."""
    words, lines, cur = text.split(), [], ""
    for word in words:
        trial = f"{cur} {word}".strip()
        if draw.textlength(trial, font=fnt) <= max_width or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def text_png(text: str, out: Path, *, size: int, fg="white", bg=(0, 0, 0, 140),
             pad: int = 14, max_width: int | None = None) -> Path:
    """Render `text` to an RGBA PNG sized to its own content."""
    fnt = font(size)
    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    lines = _wrap(text, probe, fnt, max_width) if max_width else [text]

    widths, heights = [], []
    for line in lines:
        box = probe.textbbox((0, 0), line, font=fnt)
        widths.append(box[2] - box[0])
        heights.append(box[3] - box[1])
    line_h = (max(heights) if heights else size) + 6
    w = (max(widths) if widths else 1) + pad * 2
    h = line_h * len(lines) + pad * 2

    img = Image.new("RGBA", (max(w, 1), max(h, 1)), bg)
    draw = ImageDraw.Draw(img)
    for i, line in enumerate(lines):
        box = draw.textbbox((0, 0), line, font=fnt)
        draw.text((pad - box[0], pad - box[1] + i * line_h), line, font=fnt, fill=fg)
    img.save(out)
    return out


@dataclass
class Cue:
    text: str
    start: float
    end: float


def srt_timestamp(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int(round((seconds - int(seconds)) * 1000))
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def write_srt(cues: list[Cue], out: Path) -> Path:
    blocks: list[str] = []
    for i, cue in enumerate(cues, start=1):
        # SRT delimits blocks with blank lines, so any newline inside the copy
        # would end the cue early and orphan the rest of the sentence.
        text = " ".join(cue.text.split())
        blocks += [str(i), f"{srt_timestamp(cue.start)} --> {srt_timestamp(cue.end)}", text, ""]
    out.write_text("\n".join(blocks), encoding="utf-8")
    return out


def write_vtt(cues: list[Cue], out: Path) -> Path:
    """WebVTT for the browser player — `<track kind="captions">` cannot read SRT."""
    blocks = ["WEBVTT", ""]
    for cue in cues:
        text = " ".join(cue.text.split())
        start = srt_timestamp(cue.start).replace(",", ".")
        end = srt_timestamp(cue.end).replace(",", ".")
        blocks += [f"{start} --> {end}", text, ""]
    out.write_text("\n".join(blocks), encoding="utf-8")
    return out
