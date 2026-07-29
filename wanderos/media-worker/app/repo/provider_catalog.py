"""THE only module importing genblaze provider classes (sponsor-sample convention).

Tiers:
  mock  — Mock providers, zero keys, zero cost (CI + local dev + seam tests)
  dev   — cheapest real models (GMI credits) for iteration
  final — premium models, demo renders only
Model ids for dev/final re-verified against the GMI console before first real run;
ModelRegistry absorbs any drift.
"""
from __future__ import annotations

import hashlib

from genblaze import Asset, BaseProvider, MockAudioProvider, MockProvider, MockVideoProvider

from app.config.settings import settings


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


def image_provider() -> BaseProvider:
    """AWS Bedrock (Stability) is primary; GMI Cloud is the fallback."""
    if settings.pipeline_tier == "mock":
        return MockProvider(name="mock-image", assets=_mock_asset("image"))

    from app.repo.providers_aws import BedrockImageProvider, aws_configured

    if aws_configured():
        return BedrockImageProvider()
    if settings.gmi_api_key:
        from genblaze_gmicloud import GMICloudImageProvider

        return GMICloudImageProvider(api_key=settings.gmi_api_key)
    return MockProvider(name="mock-image", assets=_mock_asset("image"))


def video_provider() -> BaseProvider:
    if settings.pipeline_tier == "mock" or not settings.gmi_api_key:
        return MockVideoProvider(name="mock-video", assets=_mock_asset("video"))
    from genblaze_gmicloud import GMICloudVideoProvider

    return GMICloudVideoProvider(api_key=settings.gmi_api_key)


def tts_provider() -> BaseProvider:
    """ElevenLabs for the final render if keyed; otherwise AWS Polly, then GMI."""
    if settings.pipeline_tier == "mock":
        return MockAudioProvider(name="mock-tts", assets=_mock_asset("audio"))
    if settings.pipeline_tier == "final" and settings.elevenlabs_api_key:
        from genblaze_elevenlabs import ElevenLabsTTSProvider

        return ElevenLabsTTSProvider(api_key=settings.elevenlabs_api_key)

    from app.repo.providers_aws import PollyTTSProvider, aws_configured

    if aws_configured():
        return PollyTTSProvider()
    if settings.gmi_api_key:
        from genblaze_gmicloud import GMICloudAudioProvider

        return GMICloudAudioProvider(api_key=settings.gmi_api_key)
    return MockAudioProvider(name="mock-tts", assets=_mock_asset("audio"))


MODELS = {
    "mock": {"image": "mock-enhance-v1", "video": "mock-kling-v2", "video_fallbacks": ["mock-seedance"], "tts": "mock-tts-v1"},
    "dev": {
        "image": "seedream-5.0-lite",
        "video": "kling-image2video-v2.1-master",
        "video_fallbacks": ["seedance-2-0-260128"],
        "tts": "minimax-tts",
    },
    "final": {
        "image": "seedream-5.0",
        "video": "kling-image2video-v2.1-master",
        "video_fallbacks": ["seedance-2-0-260128"],
        "tts": "eleven_v3",
    },
}

# Model ids differ per provider; the pipeline is identical either way. Bedrock has
# no ACTIVE video model (Nova Reel is LEGACY), so video stays on GMI Cloud and
# degrades to the free ffmpeg parallax path on a Bedrock still when GMI is down.
AWS_MODELS = {
    "dev": {"image": "stability.stable-image-core-v1:1", "tts": "Joanna"},
    "final": {"image": "stability.sd3-5-large-v1:0", "tts": "Joanna"},
}


def models() -> dict:
    tier = settings.pipeline_tier if settings.pipeline_tier in MODELS else "mock"
    chosen = dict(MODELS[tier])
    if tier != "mock":
        from app.repo.providers_aws import aws_configured

        if aws_configured():
            chosen["image"] = AWS_MODELS[tier]["image"]
            if not (tier == "final" and settings.elevenlabs_api_key):
                chosen["tts"] = AWS_MODELS[tier]["tts"]
    return chosen
