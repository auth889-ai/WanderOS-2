"""Film composition — adaptation of the vendored Backblaze composer pattern
(vendor/backblaze_samples/composer.py, MIT): hardened single-entry ffmpeg invoker.
Text is rendered with Pillow and applied via ffmpeg `overlay` — portable across ANY
ffmpeg build (minimal builds lack drawtext/libass; overlay is universal).
ffmpeg is the sponsor-sanctioned assembler ("the only non-Genblaze adapter").
"""
from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def _run_ffmpeg(args: list[str], *, stage: str, timeout: int = 300) -> None:
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args],
            capture_output=True, text=True, timeout=timeout, check=True,
        )
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"ffmpeg {stage} failed: {(exc.stderr or '').strip()[:400]}") from exc


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for cand in ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/Supplemental/Arial.ttf",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(cand, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _text_png(text: str, out: Path, *, size: int, fg="white", bg=(0, 0, 0, 140), pad=14) -> Path:
    font = _font(size)
    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    box = probe.textbbox((0, 0), text, font=font)
    w, h = box[2] - box[0] + pad * 2, box[3] - box[1] + pad * 2
    img = Image.new("RGBA", (w, h), bg)
    ImageDraw.Draw(img).text((pad - box[0], pad - box[1]), text, font=font, fill=fg)
    img.save(out)
    return out


@dataclass
class SceneClip:
    path: Path
    narration_line: str
    synthetic: bool  # burned "AI-recreated scene" disclosure when True (trust thesis)


def compose_film(
    scenes: list[SceneClip], narration_audio: Path | None, out: Path,
    *, title: str, fps: int = 24, size: str = "1280x720",
) -> Path:
    work = out.parent
    W, H = (int(x) for x in size.split("x"))
    prepared: list[Path] = []

    # 2s title card: background + centered Pillow-rendered title
    title_png = _text_png(title, work / "t_title.png", size=46, bg=(0, 0, 0, 0))
    card = work / "card_title.mp4"
    _run_ffmpeg(
        ["-f", "lavfi", "-i", f"color=c=0x0f172a:s={size}:d=2:r={fps}", "-i", str(title_png),
         "-filter_complex", "[0][1]overlay=(W-w)/2:(H-h)/2", "-pix_fmt", "yuv420p", str(card)],
        stage="title-card",
    )
    prepared.append(card)

    ai_png = _text_png("AI-recreated scene", work / "t_ai.png", size=22, fg=(255, 209, 102, 255))
    for i, sc in enumerate(scenes):
        sub_png = _text_png(sc.narration_line, work / f"t_sub{i}.png", size=26)
        labeled = work / f"scene_{i:02d}.mp4"
        inputs = ["-i", str(sc.path), "-i", str(sub_png)]
        fc = f"[0]scale={size},fps={fps}[v0];[v0][1]overlay=(W-w)/2:H-h-28"
        if sc.synthetic:
            inputs += ["-i", str(ai_png)]
            fc += "[v1];[v1][2]overlay=24:24"
        _run_ffmpeg([*inputs, "-filter_complex", fc, "-an", "-pix_fmt", "yuv420p", str(labeled)],
                    stage=f"label-scene-{i}")
        prepared.append(labeled)

    concat_list = work / "concat.txt"
    concat_list.write_text("".join(f"file '{p.name}'\n" for p in prepared))
    silent = work / "film_silent.mp4"
    _run_ffmpeg(["-f", "concat", "-safe", "0", "-i", str(concat_list), "-c", "copy", str(silent)], stage="concat")

    if narration_audio and narration_audio.exists():
        _run_ffmpeg(["-i", str(silent), "-i", str(narration_audio), "-map", "0:v", "-map", "1:a",
                     "-c:v", "copy", "-c:a", "aac", "-shortest", str(out)], stage="mix-narration")
    else:
        _run_ffmpeg(["-i", str(silent), "-c", "copy", str(out)], stage="finalize")
    return out
