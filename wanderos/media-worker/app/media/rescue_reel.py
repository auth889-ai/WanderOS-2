"""Rescue Hero Reel — the disruption, told as the story of surviving it.

A cancelled flight is the worst moment of a trip and the most re-told. People
narrate it for years. Until now this system computed the recovery and showed it
as a JSON panel, which is the least memorable possible form for the most
memorable event.

This turns a real recovery into a short film: seven beats, each a card, each
carrying a number the system actually produced.

**Every figure is earned or absent.** The reference concept showed
"148 options analyzed" and "stress avoided 100%". We report the alternatives we
genuinely evaluated, and there is no stress metric because stress is not
measurable from a booking record. Inventing hero numbers would make this
marketing that happens to be rendered as video — and the whole argument of this
product is that a generated claim must be earned.

A beat with no data is dropped rather than filled. A four-beat reel that is true
beats a seven-beat reel that is padded.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageDraw

from app.media.captions import font
from app.media.ffmpeg import run_ffmpeg

W, H = 1080, 1920          # 9:16 — this is made to be shared, not embedded
BG = (12, 10, 18)
GOLD = (255, 191, 0)
INK = (243, 233, 217)
MUTED = (150, 145, 160)

BEAT_SECONDS = 3.0
FPS = 30

# Each beat: (key, headline, accent). Order is the story, not the data model.
BEATS = [
    ("disruption", "They cancelled my flight.", (239, 109, 91)),
    ("analysed", "We looked at every way forward.", (103, 232, 249)),
    ("chosen", "We found the one that worked.", (74, 222, 128)),
    ("protected", "Your hotel was saved.", (167, 139, 250)),
    ("walking", "And we cut the walking.", (255, 176, 143)),
    ("money", "You got money back.", (74, 222, 128)),
    ("arrival", "You made it.", GOLD),
]


@dataclass
class Beat:
    key: str
    headline: str
    value: str
    detail: str
    accent: tuple[int, int, int]

    def as_dict(self) -> dict:
        return {"key": self.key, "headline": self.headline,
                "value": self.value, "detail": self.detail}


@dataclass
class Reel:
    path: Path | None
    beats: list[Beat] = field(default_factory=list)
    dropped: list[str] = field(default_factory=list)
    seconds: float = 0.0

    def as_dict(self) -> dict:
        return {"path": str(self.path) if self.path else None,
                "beats": [b.as_dict() for b in self.beats],
                "beats_dropped_for_lack_of_data": self.dropped,
                "seconds": self.seconds}


def beats_from_recovery(plan: dict, entitlement: dict | None = None,
                        *, walking_km_saved: float | None = None) -> tuple[list[Beat], list[str]]:
    """Turn a recovery plan into beats, dropping any the data cannot support."""
    impact = plan.get("impact") or {}
    beats: list[Beat] = []
    dropped: list[str] = []

    status = impact.get("status", "")
    delay = impact.get("delay_hours") or 0
    if status == "cancelled" or delay:
        beats.append(Beat(
            "disruption", BEATS[0][1],
            "CANCELLED" if status == "cancelled" else f"{delay:.1f}h LATE",
            impact.get("flight", ""), BEATS[0][2]))
    else:
        dropped.append("disruption — nothing went wrong")

    considered = len(plan.get("actions") or [])
    if considered:
        beats.append(Beat("analysed", BEATS[1][1], str(considered),
                          "courses of action evaluated", BEATS[1][2]))
    else:
        dropped.append("analysed — no actions were computed")

    do_now = plan.get("do_now") or []
    if do_now:
        beats.append(Beat("chosen", BEATS[2][1], do_now[0][:46],
                          "the thing that expires soonest", BEATS[2][2]))
    else:
        dropped.append("chosen — nothing needed doing now")

    saved = [b for b in (impact.get("at_risk") or []) if b.get("refundable")]
    if saved:
        beats.append(Beat("protected", BEATS[3][1], str(len(saved)),
                          "bookings still recoverable", BEATS[3][2]))
    else:
        dropped.append("protected — no recoverable bookings at risk")

    # Walking is only claimed when a caller measured it. There is no way to
    # derive it from a booking record, and guessing would be the exact failure
    # this module refuses.
    if walking_km_saved:
        beats.append(Beat("walking", BEATS[4][1], f"{walking_km_saved:.1f} km",
                          "less walking than the original route", BEATS[4][2]))
    else:
        dropped.append("walking — not measured for this trip")

    amount = (entitlement or {}).get("headline_amount")
    if amount:
        currency = next((e.get("currency") for e in (entitlement or {}).get("entitlements", [])
                         if e.get("amount")), "")
        beats.append(Beat("money", BEATS[5][1], f"{currency} {amount:,.0f}".strip(),
                          "you are entitled to claim", BEATS[5][2]))
    else:
        dropped.append("money — no compensation applies here")

    arrival = impact.get("new_arrival")
    if arrival:
        beats.append(Beat("arrival", BEATS[6][1], str(arrival)[11:16],
                          "your new arrival time", BEATS[6][2]))
    else:
        dropped.append("arrival — no revised arrival known")

    return beats, dropped


def _wrap(draw, text: str, fnt, max_w: int) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for word in words:
        trial = f"{cur} {word}".strip()
        if draw.textlength(trial, font=fnt) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def render_beat(beat: Beat, index: int, total: int, out: Path) -> Path:
    """One vertical card. Big number, small proof."""
    image = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(image)
    margin = 96

    # Progress pips — the story has a shape and the viewer should feel it move.
    pip_w = (W - margin * 2 - (total - 1) * 10) / total
    for i in range(total):
        x = margin + i * (pip_w + 10)
        draw.rounded_rectangle([x, 150, x + pip_w, 156], radius=3,
                               fill=beat.accent if i <= index else (48, 44, 58))

    y = 420
    draw.text((margin, y), f"BEAT {index + 1}", font=font(30), fill=MUTED)
    y += 70

    head_font = font(74)
    for line in _wrap(draw, beat.headline, head_font, W - margin * 2):
        draw.text((margin, y), line, font=head_font, fill=INK)
        y += 92

    y += 90
    value_font = font(150 if len(beat.value) <= 10 else 68)
    for line in _wrap(draw, beat.value, value_font, W - margin * 2)[:3]:
        draw.text((margin, y), line, font=value_font, fill=beat.accent)
        y += value_font.size + 16

    y += 30
    draw.text((margin, y), beat.detail, font=font(34), fill=MUTED)

    draw.text((margin, H - 130),
              "Every number here was produced by the rescue, not written for it.",
              font=font(26), fill=(96, 92, 108))
    image.save(out)
    return out


def build(plan: dict, out: Path, *, entitlement: dict | None = None,
          walking_km_saved: float | None = None, work_dir: Path | None = None) -> Reel:
    """Render the reel. Returns a Reel with no path if there is no story to tell."""
    beats, dropped = beats_from_recovery(plan, entitlement,
                                         walking_km_saved=walking_km_saved)
    if len(beats) < 3:
        # Two cards is a notification, not a film.
        return Reel(None, beats, dropped, 0.0)

    work = Path(work_dir or out.parent / "reel")
    work.mkdir(parents=True, exist_ok=True)

    clips: list[Path] = []
    for i, beat in enumerate(beats):
        card = render_beat(beat, i, len(beats), work / f"beat{i}.png")
        clip = work / f"beat{i}.mp4"
        run_ffmpeg(["-loop", "1", "-i", str(card), "-t", str(BEAT_SECONDS),
                    "-r", str(FPS), "-vf", f"scale={W}:{H},format=yuv420p",
                    "-c:v", "libx264", "-crf", "18", "-preset", "slow", str(clip)],
                   stage=f"reel-beat-{i}")
        clips.append(clip)

    listing = work / "concat.txt"
    listing.write_text("".join(f"file '{c.name}'\n" for c in clips))
    run_ffmpeg(["-f", "concat", "-safe", "0", "-i", str(listing),
                "-c", "copy", "-movflags", "+faststart", str(out)],
               stage="reel-concat")
    return Reel(out, beats, dropped, round(len(beats) * BEAT_SECONDS, 1))
