"""The music bed — the thing that makes a travel film feel finished.

`compose_film` has accepted a `music` argument since the composer was rewritten,
and nothing has ever supplied one. Every film shipped with narration over
silence, which is why they read as documentation rather than as films.

Approach taken from the official Backblaze multi-provider sample, including a
gotcha that would have cost an afternoon to find:

**MiniMax-Music requires a `lyrics` payload field.** The default audio family
allowlist drops it, so a bare prompt fails with
`lyrics (Required parameter is missing)`. The sample solves this by registering
a per-model override admitting `lyrics` and `is_instrumental`, defaulting them
to a vocal-free score. Same fix here.

**No new API key.** This runs on the GMI key already configured. Replicate
(`meta/musicgen`) is the sample's other option and would need a new token, so it
is a fallback rather than the default.

The prompt is derived from the trip rather than fixed, because a single stock
bed under every film is the same failure as a single stock camera move: it
reads as a template. But it is deliberately *unremarkable* music — a score that
draws attention to itself is competing with the narration it exists to support.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from app.config.settings import settings

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "minimax-music-2.5"
# Long enough to cover a typical film without looping; generation cost scales
# with duration, so this is not set generously.
DEFAULT_SECONDS = 60

# Mood taken from what the trip actually was, not from a dropdown.
MOOD_PROMPTS = {
    "coastal": "warm acoustic guitar and soft strings, unhurried, sunlit, instrumental",
    "urban": "understated piano with light percussion, curious, moving, instrumental",
    "mountain": "sparse piano and low strings, wide and still, instrumental",
    "cold": "quiet ambient pads with a slow piano figure, crisp, instrumental",
    "tropical": "gentle acoustic guitar, soft marimba, warm and open, instrumental",
    "reflective": "solo piano, spacious, unresolved, instrumental",
}
DEFAULT_MOOD = "reflective"

# Keywords in scene labels that imply a mood. Deliberately small — a wrong
# guess here is harmless, and the fallback is a neutral piano bed.
MOOD_HINTS = {
    "coastal": ("beach", "sea", "ocean", "coast", "sunset", "island", "bay"),
    "tropical": ("jungle", "temple", "rice", "palm", "bali", "tropical"),
    "mountain": ("mountain", "hike", "peak", "valley", "trail", "fjord"),
    "cold": ("snow", "ice", "winter", "glacier", "arctic", "nordic"),
    "urban": ("city", "street", "market", "cafe", "museum", "quarter", "town"),
}


@dataclass
class Score:
    path: Path | None
    mood: str
    prompt: str
    model: str = ""
    available: bool = False
    reason: str = ""

    def as_dict(self) -> dict:
        return {**self.__dict__, "path": str(self.path) if self.path else None}


def infer_mood(labels: list[str]) -> str:
    """Pick a mood from what the scenes are actually of."""
    text = " ".join(labels).lower()
    scores = {mood: sum(1 for hint in hints if hint in text)
              for mood, hints in MOOD_HINTS.items()}
    best = max(scores, key=scores.get) if scores else DEFAULT_MOOD
    return best if scores.get(best, 0) > 0 else DEFAULT_MOOD


def _instrumental_registry():
    """Admit the fields MiniMax-Music requires, defaulted to no vocals.

    Without this a bare prompt returns
    `lyrics (Required parameter is missing)` — the default family allowlist
    drops the field entirely. Lifted from the official Backblaze sample.
    """
    from dataclasses import replace

    # Lives in the GMI package, not genblaze core — the sample imports it from
    # genblaze_gmicloud.models.audio, and guessing genblaze.* fails at import.
    from genblaze_gmicloud.models.audio import build_audio_registry

    registry = build_audio_registry()
    base = registry.get(DEFAULT_MODEL)
    registry.register(replace(
        base,
        param_allowlist=(base.param_allowlist or frozenset()) | {"lyrics", "is_instrumental"},
        param_defaults={**dict(base.param_defaults), "lyrics": "[Inst]",
                        "is_instrumental": True},
    ))
    return registry


def generate(job_id: str, trip_id: str, *, labels: list[str] | None = None,
             seconds: int = DEFAULT_SECONDS, work_dir: Path | None = None) -> Score:
    """Generate an instrumental bed. Never raises — a silent film is still a film."""
    mood = infer_mood(labels or [])
    prompt = MOOD_PROMPTS[mood]

    if not settings.gmi_api_key:
        return Score(None, mood, prompt, available=False,
                     reason="no GMI key configured; the film plays without music")

    try:
        from genblaze import Modality, Pipeline
        from genblaze_gmicloud import GMICloudAudioProvider

        from app.media import pipelines
        from app.media.scenes import fetch_asset, work_dir as job_work

        provider = GMICloudAudioProvider(api_key=settings.gmi_api_key,
                                         models=_instrumental_registry())
        pipeline = (
            Pipeline(f"score-{job_id}", tenant_id=job_id, chain=True)
            .cache(pipelines._cache())
            .tracer(pipelines._tracer(job_id))
            .step(provider, model=DEFAULT_MODEL, modality=Modality.AUDIO,
                  prompt=prompt, duration=seconds)
        )
        result = pipelines.run_pipeline(pipeline, trip_id, job_id=job_id)
        run = getattr(result, "run", result)

        for step in getattr(run, "steps", []) or []:
            for asset in getattr(step, "assets", []) or []:
                if "audio" in (asset.media_type or ""):
                    target = Path(work_dir or job_work(job_id)) / "score.mp3"
                    path = fetch_asset(asset.url, target)
                    if path:
                        return Score(path, mood, prompt, DEFAULT_MODEL, available=True)
        return Score(None, mood, prompt, DEFAULT_MODEL, available=False,
                     reason="no audio asset returned")
    except Exception as exc:
        # Music is the last thing that should fail a render — it is the most
        # decorative part of the film and the most likely to hit a provider quirk.
        logger.warning("score generation failed: %s", exc)
        return Score(None, mood, prompt, DEFAULT_MODEL, available=False,
                     reason=f"{type(exc).__name__}: {exc}"[:180])
