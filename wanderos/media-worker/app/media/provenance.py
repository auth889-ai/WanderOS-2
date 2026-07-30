"""Provenance made visible — the film shows what it refused to invent.

The trust machinery was invisible. A viewer saw a slideshow, because every
scene the system REFUSED to fabricate was silently dropped before composition,
and every scene it did build carried no mark of where it came from. All the
evidence gating happened in logs nobody watches.

That is backwards. A generator that declines to invent your past is the entire
product, and it was the one thing never shown.

So a refusal now becomes a card in the film:

    Your itinerary says: Uluwatu Temple, sunset.
    No photo. No mention in your voice note.
    You didn't confirm it — so we left it empty.

This is the CHI 2025 finding turned into a design constraint: AI video built
from AI-edited photos implanted false memories at 2.05x the rate of controls,
and people held those false memories 1.19x more confidently. A product that
fills gaps beautifully is a product that rewrites what you believe happened.
Leaving the gap visible is the feature.

Every scene also carries a badge naming its origin, so "this really happened"
and "we made this up with your permission" can never be confused at a glance.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw

from app.media.captions import font

WIDTH, HEIGHT = 1280, 720

# Deliberately not a rainbow. Green = it happened. Amber = we built it and you
# said yes. Grey = we left it alone. Nothing here is decorative.
ORIGIN_STYLES = {
    "photo":      ("FROM YOUR PHOTO", (74, 222, 128), "this frame is your own photograph"),
    "clip":       ("FROM YOUR VIDEO", (74, 222, 128), "a shot from footage you filmed"),
    "parallax":   ("YOUR PHOTO, IN MOTION", (74, 222, 128), "your photograph, moved — nothing added"),
    "recreated":  ("AI-RECREATED · YOU APPROVED", (255, 191, 0), "generated after you confirmed it happened"),
    "refused":    ("LEFT EMPTY ON PURPOSE", (148, 163, 184), "we would not invent this"),
}


@dataclass
class Gap:
    """A moment the itinerary claimed but the evidence never supported."""
    claim: str
    why_empty: str
    source: str = "your itinerary"

    @classmethod
    def no_consent(cls, claim: str, source: str = "your itinerary") -> "Gap":
        return cls(claim=claim, source=source,
                   why_empty="You didn't confirm it — so we left it empty.")

    @classmethod
    def rejected(cls, claim: str, source: str = "your itinerary") -> "Gap":
        return cls(claim=claim, source=source,
                   why_empty="What we generated didn't match your trip, so we didn't use it.")


def _wrap(draw: ImageDraw.ImageDraw, text: str, fnt, max_w: int) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if draw.textlength(trial, font=fnt) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def badge_png(origin: str, out: Path) -> Path | None:
    """Small origin badge composited into the corner of a scene."""
    style = ORIGIN_STYLES.get(origin)
    if style is None:
        return None
    label, colour, _ = style
    fnt = font(20)
    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    box = probe.textbbox((0, 0), label, font=fnt)
    pad_x, pad_y, dot = 16, 10, 10
    w = (box[2] - box[0]) + pad_x * 2 + dot + 8
    h = (box[3] - box[1]) + pad_y * 2

    img = Image.new("RGBA", (w, h), (0, 0, 0, 150))
    draw = ImageDraw.Draw(img)
    cy = h // 2
    draw.ellipse([pad_x, cy - dot // 2, pad_x + dot, cy + dot // 2], fill=(*colour, 255))
    draw.text((pad_x + dot + 8 - box[0], pad_y - box[1]), label, font=fnt, fill=(255, 255, 255, 255))
    img.save(out)
    return out


def gap_card_png(gap: Gap, out: Path) -> Path:
    """A full-frame card standing in for a moment we declined to fabricate.

    Typeset to be watchable rather than to look like an error message. This is a
    deliberate authored beat in the film, not a failure notice.
    """
    img = Image.new("RGB", (WIDTH, HEIGHT), (14, 12, 20))
    draw = ImageDraw.Draw(img)
    margin = 120
    max_w = WIDTH - margin * 2
    y = 190

    label_font = font(20)
    draw.text((margin, y), f"{gap.source.upper()} SAYS", font=label_font, fill=(148, 163, 184))
    y += 46

    claim_font = font(46)
    for line in _wrap(draw, gap.claim, claim_font, max_w):
        draw.text((margin, y), line, font=claim_font, fill=(243, 233, 217))
        y += 60

    y += 34
    draw.line([(margin, y), (margin + 90, y)], fill=(255, 191, 0), width=3)
    y += 40

    why_font = font(28)
    for line in _wrap(draw, gap.why_empty, why_font, max_w):
        draw.text((margin, y), line, font=why_font, fill=(200, 200, 210))
        y += 40

    footer = font(19)
    draw.text((margin, HEIGHT - 92),
              "WanderOS does not invent moments you did not confirm.",
              font=footer, fill=(120, 125, 135))
    img.save(out)
    return out


def verification_card_png(*, sealed_sha256: str, verify_url: str, stats: dict,
                          out: Path) -> Path:
    """Closing card: what this film is made of, and how to check it.

    The hash is shown because a claim of tamper-evidence that a viewer cannot
    act on is decoration.
    """
    img = Image.new("RGB", (WIDTH, HEIGHT), (14, 12, 20))
    draw = ImageDraw.Draw(img)
    margin = 120
    y = 130

    draw.text((margin, y), "WHAT THIS FILM IS MADE OF", font=font(20), fill=(148, 163, 184))
    y += 58

    row_font = font(27)
    for label, value, colour in [
        ("From your own photos and video", str(stats.get("real", 0)), (74, 222, 128)),
        ("AI-recreated, with your approval", str(stats.get("recreated", 0)), (255, 191, 0)),
        ("Left empty because you didn't confirm", str(stats.get("refused", 0)), (148, 163, 184)),
    ]:
        draw.ellipse([margin, y + 9, margin + 12, y + 21], fill=colour)
        draw.text((margin + 28, y), label, font=row_font, fill=(226, 222, 213))
        draw.text((WIDTH - margin - 40, y), value, font=row_font, fill=colour)
        y += 52

    y += 40
    draw.line([(margin, y), (WIDTH - margin, y)], fill=(60, 58, 70), width=1)
    y += 34

    draw.text((margin, y), "SEALED · B2 OBJECT LOCK (COMPLIANCE) · ed25519",
              font=font(19), fill=(148, 163, 184))
    y += 34
    draw.text((margin, y), sealed_sha256[:32], font=font(21), fill=(103, 232, 249))
    draw.text((margin, y + 30), sealed_sha256[32:64], font=font(21), fill=(103, 232, 249))
    y += 82
    draw.text((margin, y), f"Verify independently:  {verify_url}",
              font=font(21), fill=(226, 222, 213))
    img.save(out)
    return out
