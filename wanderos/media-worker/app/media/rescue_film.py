"""Rescue Hero Reel — the film of a journey that broke and was put back together.

important.md #18 asks for this, and it is the piece that makes everything else
into a generative-media application rather than a travel tool: the logistics
work becomes the film's substance.

Every beat is backed by a persisted fact. The delay came from a flight provider,
the risk from the cascade engine, the exposure from real non-refundable
bookings, and the booking reference from the airline. **A beat with no data is
dropped, never padded** — a reel that claims a rescue that did not happen is
worse than a shorter one.

The media is generated on AWS through Genblaze providers, so it is the user's
own AWS credit doing the work and B2 holding the result:

    narration    AWS Polly        -> B2
    imagery      AWS Bedrock      -> B2   (Stability, us-west-2)
    composition  ffmpeg           -> B2 with Object Lock

**Imagery is generated ONCE and reused across beats.** A Bedrock image takes
about 144 seconds; seven of them would be seventeen minutes for a thirty-second
film. Three establish the mood and Ken Burns carries them, which is also how
real documentary editing works — the same plate, moved differently.

Every scene carries a label: CAPTURED, RECONSTRUCTED or GENERATED. A traveller
must be able to tell which parts of their own memory a machine invented.
"""
from __future__ import annotations

import concurrent.futures
import logging
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from app.media.ffmpeg import run_ffmpeg

logger = logging.getLogger(__name__)

W, H = 1080, 1920  # 9:16 — this is a reel, not a cinema film
FPS = 30
GOLD = (255, 191, 0)


@dataclass
class Beat:
    """One statement, and the evidence that entitles us to make it."""
    key: str
    line: str                    # what the narrator says
    headline: str                # what the card shows
    value: str
    detail: str
    accent: tuple[int, int, int]
    # captured | reconstructed | generated — shown on the frame, never implied.
    provenance: str
    source: str
    seconds: float = 3.4

    def as_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if k != "accent"}


@dataclass
class Film:
    path: Path | None
    beats: list[Beat] = field(default_factory=list)
    dropped: list[str] = field(default_factory=list)
    seconds: float = 0.0
    narration_assets: list[str] = field(default_factory=list)
    image_assets: list[str] = field(default_factory=list)
    providers_used: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "path": str(self.path) if self.path else None,
            "beats": [b.as_dict() for b in self.beats],
            "dropped_for_lack_of_evidence": self.dropped,
            "seconds": round(self.seconds, 1),
            "narration_assets": self.narration_assets,
            "image_assets": self.image_assets,
            "providers_used": self.providers_used,
        }


def beats_from_action(
    action: dict,
    cascade: dict | None = None,
    commitments: list[dict] | None = None,
) -> tuple[list[Beat], list[str]]:
    """Build the story from a persisted rescue. Drop what the data cannot support."""
    beats: list[Beat] = []
    dropped: list[str] = []
    commitments = commitments or []

    # 1 — what broke
    delay = (cascade or {}).get("delay_minutes")
    origin = (cascade or {}).get("origin")
    if delay and origin:
        beats.append(Beat(
            "broke",
            # Not .lower() — it mangles flight codes into "ek582".
            f"Your {origin} was {int(delay)} minutes late.",
            "Your journey broke", f"{int(delay)} MIN LATE", str(origin),
            (239, 109, 91), "captured", "flight status provider"))
    else:
        dropped.append("broke — no disruption was recorded")

    # 2 — what it threatened
    at_risk = (cascade or {}).get("at_risk") or []
    if at_risk:
        worst = at_risk[0]
        beats.append(Beat(
            "threatened",
            f"It put {worst['commitment']} at {round(worst['risk'] * 100)} percent risk.",
            "What it threatened", f"{round(worst['risk'] * 100)}% RISK",
            worst["commitment"], (251, 191, 36), "reconstructed",
            "cascade engine, from booking dependencies"))
    else:
        dropped.append("threatened — nothing downstream was at risk")

    # 3 — the money
    loss = (cascade or {}).get("expected_loss") or 0
    if loss and loss >= 1:
        currency = (cascade or {}).get("currency", "")
        beats.append(Beat(
            "money",
            f"About {int(loss)} {currency} of non-refundable booking was exposed.",
            "What it would cost", f"{currency}{int(loss)}",
            "non-refundable and exposed", (239, 109, 91), "reconstructed",
            "expected loss over non-refundable bookings"))
    else:
        dropped.append("money — nothing non-refundable was exposed")

    # 4 — what we looked at
    options = action.get("options") or []
    if options:
        beats.append(Beat(
            "searched",
            f"We compared {len(options)} genuinely different ways forward.",
            "We looked for a way through", str(len(options)),
            "options on different axes", (103, 232, 249), "reconstructed",
            "Duffel offer search"))
    else:
        dropped.append("searched — no alternatives were evaluated")

    # 5 — what was chosen, and it must be REAL
    reference = action.get("provider_reference")
    if reference and action.get("state") == "verified":
        amount = action.get("amount")
        currency = action.get("currency", "")
        beats.append(Beat(
            "held",
            f"We held you a seat. Reference {' '.join(reference)}.",
            "We held you a seat", reference,
            f"{currency} {amount} — no money moved" if amount else "no money moved",
            (167, 139, 250), "captured", f"{action.get('provider', 'provider')} order"))
    else:
        # The whole point of the film. Without a real reference there is no
        # rescue to celebrate, and claiming one would be the worst thing this
        # product could do.
        dropped.append("held — no verified provider reference; there is no rescue to show")

    # 6 — the walking, if anyone measured it
    walking = next((o.get("walkingMetres") for o in options if o.get("walkingMetres")), None)
    if walking:
        beats.append(Beat(
            "walking",
            f"Your arrival transfer is {int(walking)} metres on foot.",
            "The walking you face", f"{int(walking)} M",
            "wheelchair-profile routing — not verified step-free",
            (255, 176, 143), "reconstructed", "openrouteservice"))
    else:
        dropped.append("walking — no route was computed")

    # 7 — the close
    if any(b.key == "held" for b in beats):
        beats.append(Beat(
            "safe",
            "Your journey is possible again.",
            "You are covered", "PROTECTED",
            "held until the deadline", GOLD, "reconstructed", "journey_actions"))

    return beats, dropped


# --- media generation, on AWS through Genblaze ---------------------------

IMAGE_PROMPTS = [
    ("open", "Empty airport departure gate at night, rain on the window, "
             "abandoned seats, moody cinematic lighting, 35mm film grain, "
             "muted teal and amber, no people, no text"),
    ("middle", "Aerial view of city lights at dusk through aircraft window, "
               "cinematic, soft focus, warm amber glow, 35mm film grain, no text"),
    ("close", "Quiet hotel corridor at dawn, warm lamp light, open door, "
              "calm and safe, cinematic, muted warm palette, no people, no text"),
]


def _generate_images(work: Path) -> tuple[list[Path], list[str]]:
    """Three plates from Bedrock, generated in PARALLEL.

    Sequentially this is over seven minutes for three images. Concurrently it is
    the slowest one. Failure returns fewer plates rather than none — a film with
    two backgrounds is still a film; a film that refuses to render because one
    image timed out is not.
    """
    from genblaze import Step

    from app.media.providers_aws import BedrockImageProvider

    provider = BedrockImageProvider()

    def one(item: tuple[str, str]) -> tuple[Path, str] | None:
        name, prompt = item
        try:
            step = Step(provider="aws-bedrock-image",
                        model="stability.stable-image-core-v1:1",
                        prompt=prompt)
            out = provider.generate(step)
            asset = out.assets[0] if out.assets else None
            if not asset or not asset.url:
                return None
            import urllib.request
            path = work / f"plate_{name}.png"
            with urllib.request.urlopen(asset.url, timeout=120) as r:
                path.write_bytes(r.read())
            return path, asset.url
        except Exception as exc:  # noqa: BLE001 — one plate must not stop the film
            logger.warning("bedrock plate %s failed: %s", name, exc)
            return None

    paths: list[Path] = []
    urls: list[str] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for result in pool.map(one, IMAGE_PROMPTS):
            if result:
                paths.append(result[0])
                urls.append(result[1])
    return paths, urls


def _generate_narration(beats: list[Beat], work: Path) -> tuple[list[Path], list[str]]:
    """Polly reads each line. Fast enough to do per beat rather than in one take,
    which keeps audio and picture aligned without cutting an audio file."""
    from genblaze import Step

    from app.media.providers_aws import PollyTTSProvider

    provider = PollyTTSProvider()

    def one(pair: tuple[int, Beat]) -> tuple[int, Path, str] | None:
        index, beat = pair
        try:
            step = Step(provider="aws-polly", model="polly",
                        modality="audio", prompt=beat.line)
            out = provider.generate(step)
            asset = out.assets[0] if out.assets else None
            if not asset or not asset.url:
                return None
            import urllib.request
            path = work / f"vo{index}.mp3"
            with urllib.request.urlopen(asset.url, timeout=60) as r:
                path.write_bytes(r.read())
            return index, path, asset.url
        except Exception as exc:  # noqa: BLE001
            logger.warning("polly beat %s failed: %s", beat.key, exc)
            return None

    results: dict[int, Path] = {}
    urls: list[str] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for result in pool.map(one, list(enumerate(beats))):
            if result:
                results[result[0]] = result[1]
                urls.append(result[2])
    return [results.get(i) for i in range(len(beats))], urls  # type: ignore[misc]


def _audio_seconds(path: Path) -> float:
    """How long the narration actually is, so the card holds long enough to
    finish the sentence. A card that cuts mid-word reads as a bug."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", str(path)],
            capture_output=True, text=True, timeout=30)
        return float(out.stdout.strip())
    except Exception:
        return 0.0


def render_card(beat: Beat, index: int, total: int, plate: Path | None, out: Path) -> Path:
    """One frame: the plate, darkened, with the fact and its provenance."""
    from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

    if plate and plate.exists():
        base = Image.open(plate).convert("RGB").resize((W, H), Image.LANCZOS)
        # Darken so type stays legible over any plate — a caption that fights
        # the image is a caption nobody reads.
        base = ImageEnhance.Brightness(base).enhance(0.42)
        base = base.filter(ImageFilter.GaussianBlur(1.2))
    else:
        base = Image.new("RGB", (W, H), (16, 9, 31))

    draw = ImageDraw.Draw(base, "RGBA")

    def font(size: int, bold: bool = False):
        for candidate in (
            f"/System/Library/Fonts/Supplemental/Arial{' Bold' if bold else ''}.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ):
            try:
                return ImageFont.truetype(candidate, size)
            except Exception:
                continue
        return ImageFont.load_default()

    # progress
    seg = (W - 120) / max(1, total)
    for i in range(total):
        x0 = 60 + i * seg
        draw.rounded_rectangle([x0, 80, x0 + seg - 8, 86], 3,
                               fill=(255, 255, 255, 220 if i <= index else 60))

    draw.text((60, 150), beat.headline.upper(), font=font(30, True),
              fill=(255, 255, 255, 190))

    # the number, which is the point of the frame
    size = 132 if len(beat.value) <= 9 else 84 if len(beat.value) <= 16 else 58
    draw.text((60, H // 2 - 190), beat.value, font=font(size, True), fill=beat.accent)

    # detail, wrapped
    body = font(38)
    words, line, y = beat.detail.split(), "", H // 2 - 20
    for word in words:
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=body) > W - 120:
            draw.text((60, y), line, font=body, fill=(240, 240, 240))
            y += 50
            line = word
        else:
            line = trial
    if line:
        draw.text((60, y), line, font=body, fill=(240, 240, 240))

    # provenance — the label that separates this from every other travel reel
    tone = {"captured": (74, 222, 128), "reconstructed": (251, 191, 36),
            "generated": (167, 139, 250)}.get(beat.provenance, (200, 200, 200))
    label = f"{beat.provenance.upper()}  ·  {beat.source}"
    draw.rounded_rectangle([60, H - 190, 60 + draw.textlength(label, font=font(24)) + 44, H - 130],
                           26, fill=(0, 0, 0, 150), outline=tone + (200,), width=2)
    draw.text((82, H - 173), label, font=font(24), fill=tone)

    out.parent.mkdir(parents=True, exist_ok=True)
    base.save(out)
    return out


def build(
    action: dict,
    out: Path,
    *,
    cascade: dict | None = None,
    commitments: list[dict] | None = None,
    work_dir: Path | None = None,
    with_media: bool = True,
) -> Film:
    """Render the reel from a persisted rescue."""
    beats, dropped = beats_from_action(action, cascade, commitments)

    if not any(b.key == "held" for b in beats):
        # No verified reference means no rescue. Rendering anyway would be a
        # film about something that did not happen.
        return Film(None, beats, dropped, 0.0)
    if len(beats) < 3:
        return Film(None, beats, dropped, 0.0)

    work = Path(work_dir or out.parent / "rescue_film")
    work.mkdir(parents=True, exist_ok=True)

    plates: list[Path] = []
    image_urls: list[str] = []
    voices: list[Path | None] = [None] * len(beats)
    voice_urls: list[str] = []
    providers: list[str] = []

    if with_media:
        # Both fleets run at once: Polly is seconds, Bedrock is minutes, and
        # waiting for one before starting the other doubles the wall clock.
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            image_future = pool.submit(_generate_images, work)
            voice_future = pool.submit(_generate_narration, beats, work)
            plates, image_urls = image_future.result()
            voices, voice_urls = voice_future.result()
        if image_urls:
            providers.append("aws-bedrock (stability.stable-image-core-v1:1)")
        if voice_urls:
            providers.append("aws-polly")

    clips: list[Path] = []
    total_seconds = 0.0
    for i, beat in enumerate(beats):
        plate = plates[i % len(plates)] if plates else None
        card = render_card(beat, i, len(beats), plate, work / f"card{i}.png")

        voice = voices[i] if i < len(voices) else None
        # The card holds as long as the sentence takes, plus a breath.
        seconds = max(beat.seconds, _audio_seconds(voice) + 0.6) if voice else beat.seconds
        beat.seconds = round(seconds, 2)
        total_seconds += seconds

        clip = work / f"beat{i}.mp4"
        args = ["-loop", "1", "-i", str(card)]
        if voice and voice.exists():
            args += ["-i", str(voice)]
        args += [
            "-t", f"{seconds:.2f}", "-r", str(FPS),
            # A slow push keeps a still frame from reading as a slideshow.
            "-vf", f"scale={int(W * 1.12)}:-1,zoompan=z='min(zoom+0.0006,1.12)':"
                   f"d={int(seconds * FPS)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
                   f"s={W}x{H}:fps={FPS},format=yuv420p",
            "-c:v", "libx264", "-crf", "20", "-preset", "medium",
        ]
        if voice and voice.exists():
            args += ["-c:a", "aac", "-b:a", "160k", "-shortest"]
        args.append(str(clip))
        run_ffmpeg(args, stage=f"rescue-beat-{i}")
        clips.append(clip)

    listing = work / "clips.txt"
    listing.write_text("".join(f"file '{c.resolve()}'\n" for c in clips), encoding="utf-8")
    out.parent.mkdir(parents=True, exist_ok=True)
    run_ffmpeg(["-f", "concat", "-safe", "0", "-i", str(listing),
                "-c:v", "libx264", "-crf", "20", "-preset", "medium",
                "-c:a", "aac", "-b:a", "160k",
                "-movflags", "+faststart", str(out)], stage="rescue-concat")

    return Film(out, beats, dropped, total_seconds, voice_urls, image_urls, providers)
