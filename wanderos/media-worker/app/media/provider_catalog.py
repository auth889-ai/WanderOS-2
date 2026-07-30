"""THE only module importing genblaze provider classes (sponsor-sample convention).

Every configured API key becomes a live rung in a cross-provider failover chain
(app/repo/chain.py), so a dead vendor degrades the run instead of ending it:

  image  AWS Bedrock (Stability)  ->  OpenAI DALL-E   ->  GMI Cloud (Seedream)
  video  OpenAI Sora              ->  GMI Cloud (Kling) -> AWS Bedrock (Luma Ray)*
  audio  ElevenLabs (final tier)  ->  AWS Polly       ->  OpenAI TTS -> GMI

  * Luma Ray is ACTIVE on Bedrock us-west-2 but its async API writes to S3, so it
    only joins the chain once the IAM user is granted S3 access. Nova Reel is
    LEGACY in every region and refuses InvokeModel on cold accounts.

Tiers:
  mock  — Mock providers, zero keys, zero cost (CI + local dev + seam tests)
  dev   — cheapest real models for iteration
  final — premium models, demo renders only
"""
from __future__ import annotations

import hashlib

from genblaze import Asset, BaseProvider, MockAudioProvider, MockProvider, MockVideoProvider

from genblaze_core.providers import RetryPolicy

from app.config.settings import settings
from app.media.chain import ChainProvider, Link


def _retry() -> RetryPolicy:
    """Conservative backoff on every rung.

    Generative endpoints rate-limit and time out constantly, and a bare failure
    here drops to the next PROVIDER — which is a real cost and a quality change,
    not a free retry. Exhausting a few backed-off attempts against a provider
    that is merely busy is strictly better than failing over to a weaker model.

    respect_retry_after matters more than the backoff curve: these APIs tell you
    when to come back, and ignoring that is how you get rate-limited harder.
    """
    return RetryPolicy.conservative()


def _mock_asset(kind: str):
    def make(step):
        data = f"{kind}-{step.model}-{step.prompt}".encode()
        ext = {"image": "png", "video": "mp4", "audio": "mp3"}[kind]
        mime = {"image": "image/png", "video": "video/mp4", "audio": "audio/mp3"}[kind]
        return [
            Asset(
                asset_id=f"{kind}-{hashlib.sha256(data).hexdigest()[:12]}",
                url=f"mock://assets/{kind}.{ext}",
                media_type=mime,
                sha256=hashlib.sha256(data).hexdigest(),
                size_bytes=len(data),
            )
        ]

    return make


def _aws_ready() -> bool:
    from app.media.providers_aws import aws_configured

    return aws_configured()


# Providers that could not even be constructed, with the reason. Surfaced through
# chain_summary() so a silently shorter chain is still visible.
_UNAVAILABLE: list[dict] = []


def _add(links: list[Link], label: str, model: str, build) -> None:
    """Append a rung, tolerating a provider that cannot be built at all.

    The whole premise of this catalog is that a dead vendor degrades the run
    instead of ending it — but that only held for vendors that failed at REQUEST
    time. A vendor whose SDK renamed a class failed at IMPORT time and took the
    entire render with it, which is precisely the single point of failure the
    chain exists to remove.

    This is not hypothetical: genblaze-google renamed GeminiImageProvider to
    ImagenProvider, and every film stopped rendering with an ImportError — even
    though Bedrock and DALL-E were both configured, healthy, and ahead of Gemini
    in the chain.
    """
    try:
        links.append(Link(label, build(), model))
    except Exception as exc:
        _UNAVAILABLE.append({"provider": label, "model": model,
                             "reason": f"{type(exc).__name__}: {exc}"[:200]})


def _lazy(module: str, *names: str):
    """Return the first class in `module` matching any of `names`.

    Provider SDKs rename classes between releases. Accepting the known aliases
    means an upgrade drops a rung to a warning instead of an outage.
    """
    def build_class():
        import importlib

        mod = importlib.import_module(module)
        for name in names:
            if hasattr(mod, name):
                return getattr(mod, name)
        raise ImportError(
            f"{module} exports none of {names}; it has "
            f"{[n for n in dir(mod) if not n.startswith('_')]}"
        )
    return build_class


# --- Chain builders: one Link per configured credential, best first ---

def _image_links() -> list[Link]:
    links: list[Link] = []
    if _aws_ready():
        from app.media.providers_aws import BedrockImageProvider

        model = ("stability.sd3-5-large-v1:0" if settings.pipeline_tier == "final"
                 else "stability.stable-image-core-v1:1")
        _add(links, "aws-bedrock", model, lambda: BedrockImageProvider(retry_policy=_retry()))
    if settings.openai_api_key:
        _add(links, "openai-dalle", "gpt-image-1",
             lambda: _lazy("genblaze_openai", "DalleProvider")()(
                 api_key=settings.openai_api_key, retry_policy=_retry()))
    if settings.gemini_api_key:
        # genblaze-google renamed GeminiImageProvider -> ImagenProvider; accept both.
        _add(links, "google-imagen", "imagen-4.0-generate-001",
             lambda: _lazy("genblaze_google", "ImagenProvider", "GeminiImageProvider")()(
                 api_key=settings.gemini_api_key, retry_policy=_retry()))
    if settings.gmi_api_key:
        model = "seedream-5.0" if settings.pipeline_tier == "final" else "seedream-5.0-lite"
        _add(links, "gmi-cloud", model,
             lambda: _lazy("genblaze_gmicloud", "GMICloudImageProvider")()(
                 api_key=settings.gmi_api_key, retry_policy=_retry()))
    return links


def _video_links() -> list[Link]:
    links: list[Link] = []
    if settings.openai_api_key:
        _add(links, "openai-sora", "sora-2",
             lambda: _lazy("genblaze_openai", "SoraProvider")()(
                 api_key=settings.openai_api_key, retry_policy=_retry()))
    if settings.gmi_api_key:
        for model in ("kling-image2video-v2.1-master", "seedance-2-0-260128"):
            _add(links, "gmi-cloud", model,
                 lambda: _lazy("genblaze_gmicloud", "GMICloudVideoProvider")()(
                     api_key=settings.gmi_api_key))
    if settings.gemini_api_key:
        # Veo shipped alongside Imagen in genblaze-google — another free rung.
        _add(links, "google-veo", "veo-3.0-generate-001",
             lambda: _lazy("genblaze_google", "VeoProvider")()(
                 api_key=settings.gemini_api_key, retry_policy=_retry()))
    # Luma is text-to-video only, so it is the last resort for a scene built
    # from a real photo — but it runs on AWS credits and never needs GMI funding.
    if _aws_ready() and settings.aws_staging_bucket:
        from app.media.providers_aws import LumaRayVideoProvider

        _add(links, "aws-luma", "luma.ray-v2:0", lambda: LumaRayVideoProvider(retry_policy=_retry()))
    return links


def _audio_links() -> list[Link]:
    links: list[Link] = []
    if settings.pipeline_tier == "final" and settings.elevenlabs_api_key:
        from genblaze_elevenlabs import ElevenLabsTTSProvider

        links.append(Link("elevenlabs",
                          ElevenLabsTTSProvider(api_key=settings.elevenlabs_api_key), "eleven_v3"))
    if _aws_ready():
        from app.media.providers_aws import PollyTTSProvider

        links.append(Link("aws-polly", PollyTTSProvider(), settings.polly_voice))
    if settings.openai_api_key:
        from genblaze_openai import OpenAITTSProvider

        links.append(Link("openai-tts", OpenAITTSProvider(api_key=settings.openai_api_key),
                          "gpt-4o-mini-tts"))
    if settings.gmi_api_key:
        from genblaze_gmicloud import GMICloudAudioProvider

        links.append(Link("gmi-cloud", GMICloudAudioProvider(api_key=settings.gmi_api_key),
                          "minimax-tts"))
    return links


def _chain_or_mock(kind: str, links: list[Link], job_id: str, mock: BaseProvider) -> BaseProvider:
    if settings.pipeline_tier == "mock" or not links:
        return mock
    return ChainProvider(links, job_id=job_id, kind=kind)


def image_provider(job_id: str = "") -> BaseProvider:
    return _chain_or_mock("image", _image_links(), job_id,
                          MockProvider(name="mock-image", assets=_mock_asset("image")))


def video_provider(job_id: str = "") -> BaseProvider:
    return _chain_or_mock("video", _video_links(), job_id,
                          MockVideoProvider(name="mock-video", assets=_mock_asset("video")))


def tts_provider(job_id: str = "") -> BaseProvider:
    return _chain_or_mock("audio", _audio_links(), job_id,
                          MockAudioProvider(name="mock-tts", assets=_mock_asset("audio")))


def chain_summary() -> dict:
    """What the judge-facing UI shows: the live failover ladder per modality."""
    if settings.pipeline_tier == "mock":
        return {"image": ["mock"], "video": ["mock"], "audio": ["mock"], "unavailable": []}
    _UNAVAILABLE.clear()  # rebuilt by the link builders below
    chains = {
        "image": [f"{l.label}:{l.model}" for l in _image_links()],
        "video": [f"{l.label}:{l.model}" for l in _video_links()],
        "audio": [f"{l.label}:{l.model}" for l in _audio_links()],
    }
    # A rung that could not be built is reported rather than silently missing —
    # otherwise a chain that shrank from four providers to two looks identical
    # to one that only ever had two.
    chains["unavailable"] = list(_UNAVAILABLE)
    return chains


def models() -> dict:
    """First link of each chain — the model a step starts with before failover."""
    if settings.pipeline_tier == "mock":
        return {"image": "mock-enhance-v1", "video": "mock-kling-v2",
                "video_fallbacks": ["mock-seedance"], "tts": "mock-tts-v1"}
    image, video, audio = _image_links(), _video_links(), _audio_links()
    return {
        "image": image[0].model if image else "mock-enhance-v1",
        "video": video[0].model if video else "mock-kling-v2",
        "video_fallbacks": [l.model for l in video[1:]],
        "tts": audio[0].model if audio else "mock-tts-v1",
    }
