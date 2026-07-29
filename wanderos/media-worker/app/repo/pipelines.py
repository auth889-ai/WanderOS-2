"""Pipeline builders — the only module importing genblaze_core machinery.

Each builder returns a configured Pipeline. Storage sinks write to B2 under
trips/{trip_id}/generated/** with HIERARCHICAL keys; every run emits a manifest.
In mock tier the sink is skipped (mock:// URLs aren't uploadable) but the
pipeline/step/event mechanics are identical — which is what the seam test needs.
"""
from __future__ import annotations

from functools import lru_cache

from genblaze import (
    CompositeTracer,
    KeyStrategy,
    LoggingTracer,
    Modality,
    ObjectStorageSink,
    Pipeline,
    StepCache,
)
from genblaze_s3 import S3StorageBackend

from app.config.settings import settings
from app.repo.provider_catalog import image_provider, models, tts_provider, video_provider
from app.runtime.events import SSETracer


@lru_cache(maxsize=1)
def _backend() -> S3StorageBackend:
    return S3StorageBackend.for_backblaze(
        settings.b2_bucket_media,
        region=settings.b2_region,
        key_id=settings.b2_key_id,
        app_key=settings.b2_application_key,
    )


def _sink(trip_id: str) -> ObjectStorageSink | None:
    if not settings.b2_configured or settings.pipeline_tier == "mock":
        return None
    return ObjectStorageSink(
        _backend(), prefix=f"trips/{trip_id}/generated", key_strategy=KeyStrategy.HIERARCHICAL
    )


def _tracer(job_id: str) -> CompositeTracer:
    return CompositeTracer([LoggingTracer(), SSETracer(job_id)])


def _cache() -> StepCache:
    return StepCache(settings.step_cache_dir)


def presign(key: str, expires_in: int = 600) -> str:
    return _backend().get_url(key, expires_in=expires_in)


# --- Builders ---

def build_enhance_image(job_id: str, photo_key: str, prompt: str) -> Pipeline:
    m = models()
    kwargs = {} if (settings.pipeline_tier == "mock" or not photo_key) else {"image": presign(photo_key)}
    return (
        Pipeline(f"enhance-{job_id}", tenant_id=job_id, chain=True)
        .cache(_cache())
        .tracer(_tracer(job_id))
        .step(image_provider(), model=m["image"], modality=Modality.IMAGE, prompt=prompt, **kwargs)
    )


def build_animate_scene(
    job_id: str, image_key: str, motion_prompt: str, duration: int = 5, aspect_ratio: str = "16:9"
) -> Pipeline:
    m = models()
    kwargs = {} if settings.pipeline_tier == "mock" else {"image": presign(image_key)}
    return (
        Pipeline(f"animate-{job_id}", tenant_id=job_id, chain=True)
        .cache(_cache())
        .tracer(_tracer(job_id))
        .step(
            video_provider(),
            model=m["video"],
            fallback_models=m["video_fallbacks"],
            modality=Modality.VIDEO,
            prompt=motion_prompt,
            duration=duration,
            aspect_ratio=aspect_ratio,
            **kwargs,
        )
    )


def build_narrate(job_id: str, text: str) -> Pipeline:
    m = models()
    return (
        Pipeline(f"narrate-{job_id}", tenant_id=job_id, chain=True)
        .cache(_cache())
        .tracer(_tracer(job_id))
        .step(tts_provider(), model=m["tts"], modality=Modality.AUDIO, prompt=text)
    )


def run_pipeline(pipeline: Pipeline, trip_id: str):
    sink = _sink(trip_id)
    return pipeline.run(sink=sink, raise_on_failure=False) if sink else pipeline.run(raise_on_failure=False)
