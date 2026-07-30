"""Film composition — assembling scenes, narration, music and captions into an MP4.

This adopts the ffmpeg mechanics from the vendored Backblaze composer
(vendor/backblaze_samples/composer.py, MIT) rather than paraphrasing them. That
file is written against a different data model (genblaze runs and StoryboardSpec)
so it cannot be imported directly, but its *filter-graph* logic is model-agnostic
and carries bug fixes worth more than the lines they occupy:

  - `adelay` WITHOUT `apad`. `apad` with no length pads to infinity, and with
    `amix=duration=longest` the mix then never terminates — ffmpeg only stops at
    the timeout. `amix=longest` already extends to the longest real input.
  - ffmpeg input indices assigned per *added input*, never per scene index, so a
    scene with no narration doesn't desync every track after it.
  - Captions degrade in three steps (burn -> soft track -> none) instead of
    failing the run. Video and audio are the product; captions are a bonus.

Three bugs in the previous hand-rolled version, all of which this fixes:

  1. `-shortest` when muxing narration TRUNCATED THE FILM to the length of the
     narration track. A 20-second voiceover over a 60-second film silently
     shipped a 20-second film.
  2. No `-movflags +faststart`, so the MP4's index sat at the end of the file and
     a browser had to download the whole thing before showing frame one.
  3. One narration blob stretched across the whole film, so the voiceover drifted
     out of sync with the scene it was describing. Narration is now laid per
     scene at that scene's real start time.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from app.media.captions import Cue, text_png, write_srt, write_vtt
from app.media.ffmpeg import FFmpegError, probe_duration, run_ffmpeg

TITLE_SECONDS = 2.0
MUSIC_DUCK_DB = "-18dB"

_NO_SUB_NOTICE = "Captions unavailable — the film has no embedded caption track."


@dataclass
class SceneClip:
    path: Path
    narration_line: str
    synthetic: bool  # burns an "AI-recreated scene" disclosure (the trust thesis)
    narration_path: Path | None = None  # per-scene voiceover, laid at scene start
    duration: float = 0.0  # 0 = probe it
    origin: str = ""  # photo | clip | parallax | recreated — drives the badge

    def resolved_origin(self) -> str:
        return self.origin or ("recreated" if self.synthetic else "photo")

    def resolved_duration(self) -> float:
        if self.duration > 0:
            return self.duration
        self.duration = probe_duration(self.path)
        return self.duration


@dataclass
class FilmResult:
    path: Path
    duration: float
    captions_srt: Path | None = None
    captions_vtt: Path | None = None
    burned_captions: bool = False
    notices: list[str] = field(default_factory=list)


def _mix_audio(scenes: list[SceneClip], music: Path | None, work: Path,
               *, offset: float) -> Path | None:
    """Lay each scene's narration at its own start time, then add the music bed.

    `offset` is the title card, which plays before scene one — without it every
    narration line lands one title-card early.

    Music ducks under narration only when there IS narration to duck under;
    otherwise it plays at full level and carries the film on its own.
    """
    inputs: list[str] = []
    filters: list[str] = []
    labels: list[str] = []
    idx = 0
    at_ms = int(offset * 1000)

    for scene in scenes:
        if scene.narration_path is not None and scene.narration_path.exists():
            inputs += ["-i", str(scene.narration_path)]
            filters.append(f"[{idx}:a]adelay={at_ms}|{at_ms}[n{idx}]")
            labels.append(f"[n{idx}]")
            idx += 1
        at_ms += int(scene.resolved_duration() * 1000)

    if music is not None and music.exists():
        inputs += ["-i", str(music)]
        gain = MUSIC_DUCK_DB if labels else "0dB"
        filters.append(f"[{idx}:a]volume={gain}[mus]")
        labels.append("[mus]")
        idx += 1

    if not labels:
        return None  # silent film; the caller renders video only

    filters.append(
        f"{''.join(labels)}amix=inputs={len(labels)}"
        ":duration=longest:dropout_transition=0[aout]"
    )
    out = work / "audio.m4a"
    run_ffmpeg([*inputs, "-filter_complex", ";".join(filters),
                "-map", "[aout]", "-c:a", "aac", "-b:a", "192k", str(out)],
               stage="mix-audio")
    return out


def _finalize(video: Path, audio: Path | None, srt: Path | None, out: Path,
              *, burn: bool) -> Path:
    """Mux the final MP4. Captions burn, mux soft, or are omitted.

    `+faststart` moves the moov atom to the front so a browser can start playing
    on the first bytes instead of waiting for the whole download.
    """
    inputs = ["-i", str(video)]
    idx = 1
    audio_idx = None
    if audio is not None:
        inputs += ["-i", str(audio)]
        audio_idx, idx = idx, idx + 1
    sub_idx = None
    if srt is not None and not burn:
        inputs += ["-i", str(srt)]
        sub_idx, idx = idx, idx + 1

    args = [*inputs]
    if srt is not None and burn:
        # The `subtitles` filter reads the SRT path directly (not as an input).
        # Paths come from tempfile, so ':' is the only filtergraph-special
        # character we can realistically hit.
        escaped = str(srt).replace(":", r"\:")
        args += ["-filter_complex", f"[0:v]subtitles='{escaped}'[vout]", "-map", "[vout]",
                 "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p"]
    else:
        args += ["-map", "0:v", "-c:v", "copy"]

    # NOTE: no `-shortest`. It truncates the film to the shortest stream, which
    # cut every film whose narration was shorter than its picture.
    args += ["-map", f"{audio_idx}:a", "-c:a", "copy"] if audio_idx is not None else ["-an"]
    if sub_idx is not None:
        args += ["-map", f"{sub_idx}:s", "-c:s", "mov_text"]
    args += ["-movflags", "+faststart", str(out)]
    run_ffmpeg(args, stage="finalize")
    return out


def _card_clip(png: Path, out: Path, *, seconds: float, fps: int, size: str) -> Path:
    """Turn a still card into a silent clip that concat can splice in."""
    run_ffmpeg(["-loop", "1", "-i", str(png), "-t", f"{seconds}", "-r", str(fps),
                "-vf", f"scale={size}", "-pix_fmt", "yuv420p", str(out)],
               stage="card-clip")
    return out


def compose_film(
    scenes: list[SceneClip], narration_audio: Path | None, out: Path,
    *, title: str, fps: int = 24, size: str = "1280x720",
    music: Path | None = None,
    gaps: list = None,  # list[provenance.Gap] — moments we declined to fabricate
    verification: dict | None = None,  # {sealed_sha256, verify_url} for the end card
) -> FilmResult:
    """Assemble the film. `narration_audio` is a whole-film fallback for callers
    that have not yet moved to per-scene narration.

    `gaps` are rendered as full-frame cards INSIDE the film rather than dropped.
    A generator that declines to invent your past is the product; deleting the
    evidence of that decision left a slideshow behind.
    """
    from app.media.provenance import Gap, badge_png, gap_card_png, verification_card_png

    work = out.parent
    width, _height = (int(x) for x in size.split("x"))
    notices: list[str] = []
    prepared: list[Path] = []

    title_png = text_png(title, work / "t_title.png", size=46, bg=(0, 0, 0, 0),
                         max_width=int(width * 0.8))
    card = work / "card_title.mp4"
    run_ffmpeg(
        ["-f", "lavfi", "-i", f"color=c=0x0f172a:s={size}:d={TITLE_SECONDS}:r={fps}",
         "-i", str(title_png),
         "-filter_complex", "[0][1]overlay=(W-w)/2:(H-h)/2", "-pix_fmt", "yuv420p", str(card)],
        stage="title-card",
    )
    prepared.append(card)

    cues: list[Cue] = []
    at = TITLE_SECONDS

    for i, scene in enumerate(scenes):
        sub_png = text_png(scene.narration_line, work / f"t_sub{i}.png", size=26,
                           max_width=int(width * 0.86))
        labeled = work / f"scene_{i:02d}.mp4"
        inputs = ["-i", str(scene.path), "-i", str(sub_png)]
        graph = f"[0]scale={size},fps={fps}[v0];[v0][1]overlay=(W-w)/2:H-h-28"
        # Origin badge, always — "this really happened" and "we generated this
        # with your permission" must never be confusable at a glance.
        badge = badge_png(scene.resolved_origin(), work / f"t_badge{i}.png")
        if badge is not None:
            inputs += ["-i", str(badge)]
            graph += "[v1];[v1][2]overlay=24:24"
        run_ffmpeg([*inputs, "-filter_complex", graph, "-an", "-pix_fmt", "yuv420p", str(labeled)],
                   stage=f"label-scene-{i}")
        prepared.append(labeled)

        seconds = scene.resolved_duration() or probe_duration(labeled)
        scene.duration = seconds
        if scene.narration_line.strip():
            cues.append(Cue(text=scene.narration_line, start=at, end=at + seconds))
        at += seconds

    # The refusals. These are authored beats, not error notices — the whole
    # differentiator is that a viewer SEES the system decline to fabricate.
    gap_seconds = 4.0
    for g, gap in enumerate(gaps or []):
        png = gap_card_png(gap, work / f"t_gap{g}.png")
        clip = _card_clip(png, work / f"gap_{g:02d}.mp4",
                          seconds=gap_seconds, fps=fps, size=size)
        prepared.append(clip)
        cues.append(Cue(text=f"{gap.claim} — left empty, unconfirmed", start=at,
                        end=at + gap_seconds))
        at += gap_seconds

    if verification:
        stats = {
            "real": sum(1 for s in scenes if s.resolved_origin() != "recreated"),
            "recreated": sum(1 for s in scenes if s.resolved_origin() == "recreated"),
            "refused": len(gaps or []),
        }
        png = verification_card_png(
            sealed_sha256=verification.get("sealed_sha256", "—"),
            verify_url=verification.get("verify_url", ""), stats=stats,
            out=work / "t_verify.png")
        prepared.append(_card_clip(png, work / "card_verify.mp4",
                                   seconds=6.0, fps=fps, size=size))
        at += 6.0

    concat_list = work / "concat.txt"
    concat_list.write_text("".join(f"file '{p.name}'\n" for p in prepared))
    silent = work / "film_silent.mp4"
    run_ffmpeg(["-f", "concat", "-safe", "0", "-i", str(concat_list), "-c", "copy", str(silent)],
               stage="concat")

    per_scene = any(s.narration_path for s in scenes)
    if per_scene or music:
        audio = _mix_audio(scenes, music, work, offset=TITLE_SECONDS)
    elif narration_audio and narration_audio.exists():
        # Legacy whole-film narration. Still no `-shortest`, so a short voiceover
        # no longer truncates the picture.
        audio = work / "audio.m4a"
        run_ffmpeg(["-i", str(narration_audio), "-c:a", "aac", "-b:a", "192k", str(audio)],
                   stage="encode-narration")
        notices.append("Narration is a single track for the whole film, so it may drift "
                       "from the scene it describes.")
    else:
        audio = None

    srt = write_srt(cues, work / "captions.srt") if cues else None
    vtt = write_vtt(cues, work / "captions.vtt") if cues else None

    # Captions are ALREADY burned in as pixels, per scene, above. The soft track
    # is muxed for screen readers, search and viewers who want captions off —
    # never burned a second time, which would double every line on screen.
    try:
        final = _finalize(silent, audio, srt, out, burn=False)
    except FFmpegError:
        # A container without mov_text support should still yield a film.
        notices.append(_NO_SUB_NOTICE)
        final = _finalize(silent, audio, None, out, burn=False)
        srt, vtt = None, vtt

    return FilmResult(
        path=final,
        duration=probe_duration(final),
        captions_srt=srt,
        captions_vtt=vtt,
        burned_captions=True,
        notices=notices,
    )
