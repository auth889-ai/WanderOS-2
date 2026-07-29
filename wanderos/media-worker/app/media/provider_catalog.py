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

from app.config.settings import settings
from app.media.chain import ChainProvider, Link


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


# --- Chain builders: one Link per configured credential, best first ---

def _image_links() -> list[Link]:
    links: list[Link] = []
    if _aws_ready():
        from app.media.providers_aws import BedrockImageProvider

        model = ("stability.sd3-5-large-v1:0" if settings.pipeline_tier == "final"
                 else "stability.stable-image-core-v1:1")
        links.append(Link("aws-bedrock", BedrockImageProvider(), model))
    if settings.openai_api_key:
        from genblaze_openai import DalleProvider

        links.append(Link("openai-dalle", DalleProvider(api_key=settings.openai_api_key),
                          "gpt-image-1"))
    if settings.gmi_api_key:
        from genblaze_gmicloud import GMICloudImageProvider

        model = "seedream-5.0" if settings.pipeline_tier == "final" else "seedream-5.0-lite"
        links.append(Link("gmi-cloud", GMICloudImageProvider(api_key=settings.gmi_api_key), model))
    return links


def _video_links() -> list[Link]:
    links: list[Link] = []
    if settings.openai_api_key:
        from genblaze_openai import SoraProvider

        links.append(Link("openai-sora", SoraProvider(api_key=settings.openai_api_key), "sora-2"))
    if settings.gmi_api_key:
        from genblaze_gmicloud import GMICloudVideoProvider

        provider = GMICloudVideoProvider(api_key=settings.gmi_api_key)
        links.append(Link("gmi-cloud", provider, "kling-image2video-v2.1-master"))
        links.append(Link("gmi-cloud", provider, "seedance-2-0-260128"))
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


def chain_summary() -> dict[str, list[str]]:
    """What the judge-facing UI shows: the live failover ladder per modality."""
    if settings.pipeline_tier == "mock":
        return {"image": ["mock"], "video": ["mock"], "audio": ["mock"]}
    return {
        "image": [f"{l.label}:{l.model}" for l in _image_links()],
        "video": [f"{l.label}:{l.model}" for l in _video_links()],
        "audio": [f"{l.label}:{l.model}" for l in _audio_links()],
    }


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
