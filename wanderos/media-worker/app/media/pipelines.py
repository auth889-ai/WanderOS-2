"""Pipeline builders — the only module importing genblaze_core machinery.

Each builder returns a configured Pipeline. Storage sinks write to B2 under
trips/{trip_id}/generated/** with HIERARCHICAL keys; every run emits a manifest.
In mock tier the sink is skipped (mock:// URLs aren't uploadable) but the
pipeline/step/event mechanics are identical — which is what the seam test needs.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timedelta, timezone
from functools import lru_cache

from genblaze import (
    CompositeTracer,
    KeyStrategy,
    LoggingTracer,
    Modality,
    ModerationHook,
    ModerationResult,
    ObjectLockConfig,
    ObjectStorageSink,
    Pipeline,
    StepCache,
)
from genblaze_s3 import S3StorageBackend

from app.config.settings import settings
from app.media.provider_catalog import image_provider, models, tts_provider, video_provider
from app.runtime.events import SSETracer

logger = logging.getLogger(__name__)

# Prediction IDs persisted the moment a provider accepts the job, BEFORE polling
# begins. See _checkpoint().
_SUBMISSIONS: dict[str, dict] = {}


@lru_cache(maxsize=1)
def _backend() -> S3StorageBackend:
    return S3StorageBackend.for_backblaze(
        settings.b2_bucket_media,
        region=settings.b2_region,
        key_id=settings.b2_key_id,
        app_key=settings.b2_application_key,
    )


@lru_cache(maxsize=1)
def _provenance_backend() -> S3StorageBackend:
    """Separate bucket, because this one has Object Lock enabled at creation —
    a property that cannot be switched on later."""
    return S3StorageBackend.for_backblaze(
        settings.b2_bucket_provenance,
        region=settings.b2_region,
        key_id=settings.b2_key_id,
        app_key=settings.b2_application_key,
    )


class TravelModerationHook(ModerationHook):
    """Refuse prompts that would put identifiable people into generated scenes.

    The consent gate governs whether a MOMENT may be recreated. It says nothing
    about who appears in the recreation, and a generated scene containing a
    recognisable person is a different consent question that nobody answered —
    a travelling companion cannot agree to being synthesised into a memory they
    were not asked about.

    Runs before the cache lookup, so a refused prompt never reaches a provider
    and never costs anything.
    """

    NAMED_PERSON_TERMS = (
        "photorealistic face", "recognisable face", "recognizable face",
        "portrait of my", "likeness of", "deepfake",
    )

    def check_prompt(self, prompt: str, params: dict) -> ModerationResult:
        lowered = (prompt or "").lower()
        for term in self.NAMED_PERSON_TERMS:
            if term in lowered:
                return ModerationResult(
                    allowed=False,
                    reason=(f"prompt asks for a person's likeness ('{term}'). Recreating a "
                            "moment is consented separately from synthesising a person into it."),
                )
        return ModerationResult(allowed=True)

    def check_output(self, assets) -> ModerationResult:
        # Deliberately a pass-through: the hook does not fetch asset bytes, so it
        # cannot inspect the picture. The Claude critic in reasoning/critic.py is
        # what actually looks at the frame. Pretending to check here would be
        # security theatre.
        return ModerationResult(allowed=True)


def _parquet_sink():
    """Queryable run history: every step, model, cost and outcome as columnar data.

    This is what makes the Experience Graph answerable with a query instead of by
    replaying JSON manifests — "which provider served this scene, and what did the
    rejected attempts cost" is a question an operator actually asks.
    """
    if not settings.b2_configured:
        return None
    try:
        from genblaze import ParquetSink

        return ParquetSink(settings.parquet_dir)
    except Exception as exc:
        logger.warning("ParquetSink unavailable, run history will not be queryable: %s", exc)
        return None


@lru_cache(maxsize=4)
def _bucket_supports_object_lock(bucket: str) -> bool:
    """Whether a bucket can accept per-object retention at all.

    Object Lock must be enabled when the bucket is CREATED; it cannot be turned
    on later. Passing `manifest_lock` to a sink writing into a bucket without it
    does not degrade — every run fails outright with
    "Bucket is missing Object Lock Configuration", which is how this was found:
    the media bucket has no Object Lock, only the provenance bucket does.

    Probed once per bucket rather than assumed, because the answer is a property
    of how someone created the bucket, not of this code.
    """
    try:
        import boto3

        s3 = boto3.client(
            "s3", endpoint_url=f"https://s3.{settings.b2_region}.backblazeb2.com",
            aws_access_key_id=settings.b2_key_id,
            aws_secret_access_key=settings.b2_application_key,
        )
        s3.get_object_lock_configuration(Bucket=bucket)
        return True
    except Exception:
        return False


def _sink(trip_id: str) -> ObjectStorageSink | None:
    if not settings.b2_configured or settings.pipeline_tier == "mock":
        return None
    kwargs = {}
    if _bucket_supports_object_lock(settings.b2_bucket_media):
        # SDK-native Object Lock on every manifest the pipeline writes, covering
        # the per-run lineage. GOVERNANCE rather than COMPLIANCE here: intermediate
        # run manifests should be deletable by an admin during development, while
        # the final publish record in trust/sealing.py stays COMPLIANCE and is
        # immutable even to us.
        retain_until = datetime.now(timezone.utc) + timedelta(days=settings.object_lock_days)
        kwargs["manifest_lock"] = ObjectLockConfig(retain_until=retain_until, mode="GOVERNANCE")
    else:
        logger.info("bucket %s has no Object Lock configuration; per-run manifests are "
                    "unlocked (the sealed publish record is locked separately)",
                    settings.b2_bucket_media)
    return ObjectStorageSink(
        _backend(),
        prefix=f"trips/{trip_id}/generated",
        key_strategy=KeyStrategy.HIERARCHICAL,
        parquet_sink=_parquet_sink(),
        **kwargs,
    )


def _tracer(job_id: str) -> CompositeTracer:
    tracers = [LoggingTracer(), SSETracer(job_id)]
    if settings.otel_enabled:
        try:
            from genblaze import OTelTracer

            tracers.append(OTelTracer(tracer_name="wanderos.media"))
        except Exception as exc:
            logger.warning("OTel tracer unavailable: %s", exc)
    return CompositeTracer(tracers)


def _cache() -> StepCache:
    return StepCache(settings.step_cache_dir)


def _checkpoint(job_id: str):
    """Persist each completed step so a restart resumes instead of re-billing.

    Video generation is submit-then-poll and runs for minutes. A worker that
    restarts mid-run has to know what already finished, or it pays for the same
    render twice.

    NOTE: an `on_submit=` hook — which would checkpoint at submit time, before
    polling even starts — does NOT exist in genblaze 0.4.5. `Pipeline.run()`
    takes on_progress / on_step_complete / on_retry only. So the earliest
    durable point available is step completion, and the protection against
    double-billing inside a single run comes from `max_retries`, which resumes
    an existing prediction ID rather than submitting a new one.
    """
    def on_step_complete(event) -> None:
        # The callback receives a StepCompleteEvent, not the Step itself — the
        # step hangs off `.step`. Reading attributes straight off the event
        # silently produced empty strings rather than raising.
        step = getattr(event, "step", event)
        record = {
            "job_id": job_id,
            "step_index": getattr(event, "step_index", None),
            "total_steps": getattr(event, "total_steps", None),
            "elapsed_sec": getattr(event, "elapsed_sec", None),
            "step_id": str(getattr(step, "step_id", "") or getattr(step, "id", "")),
            "provider": str(getattr(step, "provider", "")),
            "model": getattr(step, "model", None),
            "status": str(getattr(step, "status", "")),
            "assets": [a.url for a in (getattr(step, "assets", None) or [])],
            "completed_at": time.time(),
        }
        _SUBMISSIONS[job_id] = record
        if not settings.b2_configured:
            return
        try:
            _backend().put(f"checkpoints/{job_id}/step-{int(record['completed_at'])}.json",
                           json.dumps(record, default=str).encode(),
                           content_type="application/json")
        except Exception as exc:
            # A lost checkpoint costs money on restart; it must not also lose the run.
            logger.warning("step checkpoint not persisted for %s: %s", job_id, exc)

    return on_step_complete


def _on_retry(job_id: str):
    """Make retries visible. A run that silently retried four times looks
    identical to one that succeeded first try, right up until the bill."""
    def handler(*args) -> None:
        from app.runtime.events import emit_job_event

        emit_job_event(job_id, "provider.retry", {"detail": str(args)[:200]})

    return handler


def last_submission(job_id: str) -> dict | None:
    """The most recent prediction ID seen for a job, for resume-after-restart."""
    return _SUBMISSIONS.get(job_id)


def presign(key: str, expires_in: int = 600) -> str:
    return _backend().get_url(key, expires_in=expires_in)


# --- Builders ---

def build_enhance_image(job_id: str, photo_key: str, prompt: str) -> Pipeline:
    m = models()
    kwargs = {} if (settings.pipeline_tier == "mock" or not photo_key) else {"image": presign(photo_key)}
    return (
        Pipeline(f"enhance-{job_id}", tenant_id=job_id, chain=True, moderation=TravelModerationHook())
        .cache(_cache())
        .tracer(_tracer(job_id))
        .step(image_provider(job_id), model=m["image"], modality=Modality.IMAGE, prompt=prompt, **kwargs)
    )


def build_animate_scene(
    job_id: str, image_key: str, motion_prompt: str, duration: int = 5, aspect_ratio: str = "16:9"
) -> Pipeline:
    m = models()
    kwargs = {} if settings.pipeline_tier == "mock" else {"image": presign(image_key)}
    return (
        Pipeline(f"animate-{job_id}", tenant_id=job_id, chain=True, moderation=TravelModerationHook())
        .cache(_cache())
        .tracer(_tracer(job_id))
        .step(
            video_provider(job_id),
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
        Pipeline(f"narrate-{job_id}", tenant_id=job_id, chain=True, moderation=TravelModerationHook())
        .cache(_cache())
        .tracer(_tracer(job_id))
        .step(tts_provider(job_id), model=m["tts"], modality=Modality.AUDIO, prompt=text)
    )


def run_pipeline(pipeline: Pipeline, trip_id: str, *, job_id: str | None = None):
    sink = _sink(trip_id)
    kwargs = {
        "raise_on_failure": False,
        # Bound both a single step and the whole run. Without the pipeline-level
        # bound a stuck poll holds a render thread until the process dies.
        "timeout": settings.step_timeout_sec,
        "pipeline_timeout": settings.pipeline_timeout_sec,
    }
    if job_id:
        kwargs["on_step_complete"] = _checkpoint(job_id)
        kwargs["on_retry"] = _on_retry(job_id)
        # Step-level retry RESUMES an existing prediction rather than
        # re-submitting, so a transient poll failure does not pay twice.
        kwargs["max_retries"] = settings.step_max_retries
    if sink:
        kwargs["sink"] = sink
    return pipeline.run(**kwargs)
