"""Render-job state machine — the durable spine of the back half of the Autopilot.

CREATED -> GENERATING -> COMPOSING -> SEALING -> DELIVERED (or FAILED with the
error preserved; a re-POST of the same job_id after failure restarts the render).

One background thread per job; scenes run with concurrency 3. State lives in an
in-memory registry mirrored to B2 (logs bucket) after every transition so the
LangGraph brain (and judges) can poll GET /jobs/{id} across restarts.
"""
from __future__ import annotations

import json
import threading
import time
import traceback
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from genblaze import Manifest

from app.config.settings import settings
from app.repo import pipelines
from app.repo.compose import SceneClip, compose_film
from app.repo.scenes import _fetch_asset, _work, render_scene
from app.repo.sealing import seal_film, verify_film
from app.runtime.events import emit_job_event

JOBS: dict[str, dict] = {}
_LOCK = threading.Lock()


def _save(job: dict) -> None:
    with _LOCK:
        JOBS[job["job_id"]] = job
    if settings.b2_configured:
        try:
            from genblaze_s3 import S3StorageBackend

            backend = S3StorageBackend.for_backblaze(
                settings.b2_bucket_logs, region=settings.b2_region,
                key_id=settings.b2_key_id, app_key=settings.b2_application_key)
            backend.put(f"render-jobs/{job['job_id']}.json",
                        json.dumps(job, default=str).encode(),
                        content_type="application/json")
        except Exception:
            pass


def _set(job: dict, status: str, **extra) -> None:
    job["status"] = status
    job["updated_at"] = time.time()
    job.update(extra)
    _save(job)
    emit_job_event(job["job_id"], f"job.{status}", {k: str(v)[:200] for k, v in extra.items()})


def _narration_audio(job_id: str, trip_id: str, text: str) -> Path | None:
    if not text:
        return None
    result = pipelines.run_pipeline(pipelines.build_narrate(job_id, text), trip_id)
    run = getattr(result, "run", result)
    for step in getattr(run, "steps", []) or []:
        for a in getattr(step, "assets", []) or []:
            if "audio" in (a.media_type or ""):
                return _fetch_asset(a.url, _work(job_id) / "narration.mp3")
    return None


def _upload_delivery(trip_id: str, film: Path, name: str) -> str | None:
    if not settings.b2_configured:
        return None
    try:
        pipelines._backend().put(f"trips/{trip_id}/delivery/{name}", film.read_bytes(),
                                 content_type="video/mp4")
        return f"trips/{trip_id}/delivery/{name}"
    except Exception:
        return None


def _run(job: dict) -> None:
    job_id, trip_id = job["job_id"], job["trip_id"]
    storyboard, consents = job["storyboard"], job.get("consents") or {}
    try:
        _set(job, "generating")
        scenes = sorted(storyboard["scenes"], key=lambda s: s["idx"])
        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(
                lambda sc: render_scene(job_id, trip_id, sc, consents), scenes))
        rendered = [r for r in results if not r["skipped"] and r["clip"] is not None]
        if not rendered:
            raise RuntimeError("no scenes rendered (all skipped or failed)")
        job["scenes"] = [{k: str(v) if isinstance(v, Path) else v for k, v in r.items()}
                        for r in results]

        _set(job, "composing")
        narration = _narration_audio(job_id, trip_id, storyboard.get("narrationFull", ""))
        by_idx = {s["idx"]: s for s in scenes}
        clips = [SceneClip(path=Path(r["clip"]),
                           narration_line=by_idx[r["idx"]].get("narrationLine", ""),
                           synthetic=r["synthetic"]) for r in rendered]
        film = compose_film(clips, narration, _work(job_id) / "film.mp4",
                            title=storyboard.get("title", "A Trip to Remember"))

        _set(job, "sealing")
        manifest = Manifest.from_run(job.get("_seed_run") or _seed_run(job_id))
        record = seal_film(film, manifest, {
            "job_id": job_id, "trip_id": trip_id,
            "scenes": job["scenes"],
            "title": storyboard.get("title"),
            "consents": consents,
        })
        job["publish_record"] = record
        verification = verify_film(Path(record["sealed_path"]), record)
        if not verification["verified"]:
            raise RuntimeError(f"self-verification failed: {verification}")

        delivery_key = _upload_delivery(trip_id, Path(record["sealed_path"]),
                                        f"{job_id}-film.sealed.mp4")
        _set(job, "delivered", film=str(record["sealed_path"]),
             delivery_key=delivery_key, verification=verification,
             stored=record["stored"])
    except Exception as exc:
        _set(job, "failed", error=f"{type(exc).__name__}: {exc}",
             trace=traceback.format_exc()[-1500:])


def _seed_run(job_id: str):
    """Minimal real run so the manifest has genuine engine lineage even when
    scene pipelines ran earlier (their own manifests are stored per attempt)."""
    from genblaze import Modality, Pipeline

    from app.repo.provider_catalog import image_provider, models

    result = Pipeline(f"compose-{job_id}", tenant_id=job_id, chain=True).step(
        image_provider(), model=models()["image"], modality=Modality.IMAGE,
        prompt="film composition record").run(raise_on_failure=False)
    return getattr(result, "run", result)


def start_render(job_id: str, trip_id: str, storyboard: dict,
                 consents: dict | None = None) -> dict:
    job = {"job_id": job_id, "trip_id": trip_id, "storyboard": storyboard,
           "consents": consents or {}, "status": "created",
           "created_at": time.time(), "updated_at": time.time()}
    _save(job)
    threading.Thread(target=_run, args=(job,), daemon=True,
                     name=f"render-{job_id}").start()
    return {"job_id": job_id, "status": "created"}


def get_job(job_id: str) -> dict | None:
    with _LOCK:
        job = JOBS.get(job_id)
    if job is None and settings.b2_configured:
        try:
            from genblaze_s3 import S3StorageBackend

            backend = S3StorageBackend.for_backblaze(
                settings.b2_bucket_logs, region=settings.b2_region,
                key_id=settings.b2_key_id, app_key=settings.b2_application_key)
            job = json.loads(backend.get(f"render-jobs/{job_id}.json"))
        except Exception:
            return None
    if job is None:
        return None
    public = {k: v for k, v in job.items() if not k.startswith("_")}
    return public
