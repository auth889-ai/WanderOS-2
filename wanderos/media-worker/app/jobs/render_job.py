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
from app.media import pipelines
from app.media.compose import SceneClip, compose_film
from app.media.provenance import Gap
from app.media.scenes import fetch_asset, work_dir, render_scene
from app.trust.sealing import seal_film, verify_film
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


def _narration_audio(job_id: str, trip_id: str, text: str, *,
                     name: str = "narration.mp3") -> Path | None:
    if not text.strip():
        return None
    result = pipelines.run_pipeline(pipelines.build_narrate(job_id, text), trip_id)
    run = getattr(result, "run", result)
    for step in getattr(run, "steps", []) or []:
        for a in getattr(step, "assets", []) or []:
            if "audio" in (a.media_type or ""):
                return fetch_asset(a.url, work_dir(job_id) / name)
    return None


def _narrate_scenes(job_id: str, trip_id: str, clips: list[SceneClip]) -> int:
    """Synthesise one voice track per scene, in parallel.

    Previously the whole film shared a single track built from
    `storyboard.narrationFull`. Two problems: storyboards written per scene leave
    that field empty, so the film shipped SILENT; and when it was populated the
    voice drifted out of sync with the scene it described, because one continuous
    read cannot know where a scene ends.

    Per-scene tracks are laid at each scene's real start time by the composer, so
    the words land on the picture they belong to. TTS is best-effort per scene: a
    scene that fails to narrate stays in the film with its caption intact.
    """
    def narrate(item: tuple[int, SceneClip]) -> None:
        i, clip = item
        try:
            clip.narration_path = _narration_audio(
                job_id, trip_id, clip.narration_line, name=f"narration-{i:02d}.mp3")
        except Exception as exc:
            emit_job_event(job_id, "narration.failed",
                           {"scene": i, "reason": f"{type(exc).__name__}: {exc}"[:200]})

    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(narrate, enumerate(clips)))
    return sum(1 for c in clips if c.narration_path)


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
        by_idx = {s["idx"]: s for s in scenes}

        def _origin(result: dict) -> str:
            source = by_idx[result["idx"]].get("source", "original")
            if result["synthetic"]:
                return "recreated"
            return {"original": "photo", "parallax": "parallax"}.get(source, "photo")

        clips = [SceneClip(path=Path(r["clip"]),
                           narration_line=by_idx[r["idx"]].get("narrationLine", ""),
                           synthetic=r["synthetic"],
                           origin=_origin(r)) for r in rendered]

        # Scenes the system REFUSED to fabricate become cards in the film instead
        # of being deleted. This is the differentiator, and it was being thrown
        # away before anyone could see it.
        gaps = []
        for r in results:
            if not r.get("skipped"):
                continue
            scene = by_idx.get(r["idx"], {})
            claim = (scene.get("title") or scene.get("narrationLine")
                     or scene.get("genPrompt") or "A moment from your itinerary")
            gaps.append(Gap.rejected(claim) if r.get("dropped") else Gap.no_consent(claim))
        if gaps:
            emit_job_event(job_id, "film.gaps_shown", {"count": len(gaps)})

        narrated = _narrate_scenes(job_id, trip_id, clips)
        emit_job_event(job_id, "narration.ready", {"scenes": len(clips), "narrated": narrated})
        # Whole-film narration only as a fallback, for storyboards that carry
        # narrationFull instead of per-scene lines.
        narration = (None if narrated
                     else _narration_audio(job_id, trip_id, storyboard.get("narrationFull", "")))

        film_result = compose_film(clips, narration, work_dir(job_id) / "film.mp4",
                                   title=storyboard.get("title", "A Trip to Remember"),
                                   gaps=gaps)
        film = film_result.path
        job["film"] = {
            "duration_sec": film_result.duration,
            "captions_srt": str(film_result.captions_srt) if film_result.captions_srt else None,
            "captions_vtt": str(film_result.captions_vtt) if film_result.captions_vtt else None,
            "burned_captions": film_result.burned_captions,
            "scenes_narrated": f"{narrated}/{len(clips)}",
            "gaps_shown": len(gaps),
            # Surfaced, not swallowed: the traveller is told what degraded.
            "notices": film_result.notices,
        }
        for notice in film_result.notices:
            emit_job_event(job_id, "film.degraded", {"notice": notice})

        _set(job, "sealing")
        manifest = Manifest.from_run(job.get("_seed_run") or _seed_run(job_id))
        record = seal_film(film, manifest, {
            "job_id": job_id, "trip_id": trip_id,
            "scenes": job["scenes"],
            "title": storyboard.get("title"),
            "consents": consents,
            # The Genblaze manifest above covers one run; the film is the product of
            # many. This is the aggregate that actually describes what was published.
            "experience_manifest": _experience_manifest(job, film),
        })
        job["publish_record"] = record
        verification = verify_film(Path(record["sealed_path"]), record)
        if not verification["verified"]:
            raise RuntimeError(f"self-verification failed: {verification}")

        delivery_key = _upload_delivery(trip_id, Path(record["sealed_path"]),
                                        f"{job_id}-film.sealed.mp4")

        # Delivery Pack — reel, cover, journal and cost, all from assets we
        # already paid for. No extra model spend.
        _set(job, "packaging")
        pack = _build_pack(job, Path(record["sealed_path"]), storyboard)

        _set(job, "delivered", film=str(record["sealed_path"]),
             delivery_key=delivery_key, verification=verification,
             stored=record["stored"], pack=pack)
    except Exception as exc:
        _set(job, "failed", error=f"{type(exc).__name__}: {exc}",
             trace=traceback.format_exc()[-1500:])


def _build_pack(job: dict, film: Path, storyboard: dict) -> dict:
    """Reel + cover + journal + cost. Each piece degrades independently — a
    failed reel must never cost the traveller their finished film."""
    from app.delivery import pack as delivery

    work = work_dir(job["job_id"])
    artifacts: dict[str, Path] = {}
    try:
        artifacts["social-reel"] = delivery.build_social_reel(
            film, work / "social-reel.mp4", title=storyboard.get("title", ""))
    except Exception as exc:
        emit_job_event(job["job_id"], "delivery.reel.failed", {"error": str(exc)[:200]})
    try:
        artifacts["cover"] = delivery.build_cover(film, work / "cover.jpg")
    except Exception as exc:
        emit_job_event(job["job_id"], "delivery.cover.failed", {"error": str(exc)[:200]})

    scenes = job.get("scenes", [])
    journal = delivery.build_journal(storyboard, job.get("claims", []) or [], scenes)
    cost = delivery.estimate_cost(scenes)
    published = delivery.publish(job["trip_id"], job["job_id"], artifacts, journal, cost)

    emit_job_event(job["job_id"], "delivery.pack.ready", {
        "outputs": list(published["keys"].keys()), "cost": cost["estimated_usd"]})
    return {"keys": published["keys"], "journal": journal, "cost": cost,
            "local": {k: str(v) for k, v in artifacts.items()}}


def _experience_manifest(job: dict, film: Path) -> dict:
    """The aggregate lineage of the published film.

    A single Genblaze run-manifest describes one pipeline run. A film is the
    product of many: every scene attempt (including the REJECTED ones), every
    critic verdict, the consent decisions, and the composed output. Signing only
    the seed run would attest to something that is not the film — so this
    aggregate is what the publish record carries, with each attempt referenced by
    its own recorded lineage path.
    """
    scenes: list[dict] = []
    for scene in job.get("scenes", []):
        attempts = scene.get("attempts", []) or []
        scenes.append({
            "idx": scene["idx"],
            "synthetic": scene.get("synthetic"),
            "skipped": scene.get("skipped"),
            "attempts": [
                {
                    "attempt": a.get("attempt"),
                    "model": a.get("model"),
                    "decision": a.get("decision"),
                    "overall": a.get("overall"),
                    "critic": a.get("critic"),
                    "violations": a.get("violations", []),
                    # every attempt, accepted or not, is addressable in B2
                    "lineage": (f"trips/{job['trip_id']}/generations/scenes/"
                                f"scene-{scene['idx']}/attempt-{a.get('attempt')}.json"),
                }
                for a in attempts
            ],
            "selected_attempt": attempts[-1].get("attempt") if attempts else None,
            "rejected_attempts": sum(1 for a in attempts if a.get("decision") == "REJECT"),
        })
    return {
        "schema": "wanderos.experience-manifest/1",
        "job_id": job["job_id"],
        "trip_id": job["trip_id"],
        "title": (job.get("storyboard") or {}).get("title"),
        "consents": job.get("consents", {}),
        "scenes": scenes,
        "film_sha256": _sha256_file(film),
        "verdicts_index": f"trips/{job['trip_id']}/evaluations/{job['job_id']}/",
        "provider_chains": _chains(),
    }


def _sha256_file(path: Path) -> str:
    import hashlib

    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _chains() -> dict:
    try:
        from app.media.provider_catalog import chain_summary

        return chain_summary()
    except Exception:
        return {}


def _seed_run(job_id: str):
    """Minimal real run so the manifest has genuine engine lineage even when
    scene pipelines ran earlier (their own manifests are stored per attempt)."""
    from genblaze import Modality, Pipeline

    from app.media.provider_catalog import image_provider, models

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
