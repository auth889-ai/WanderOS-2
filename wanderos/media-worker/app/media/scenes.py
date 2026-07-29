"""Per-scene generation engine (P5 completion) — dispatch by the planner's tool
choice, wrapped in the Genblaze AgentLoop with the Claude critic as evaluator.

Scene sources (schema.ts SceneSchema):
  original        -> still clip from the real photo (no generation)
  parallax        -> free ffmpeg zoompan motion on the real photo
  gen_image       -> image pipeline from genPrompt, then still clip
  hero_video      -> image-to-video pipeline on the real photo, critic-gated
  synthetic_scene -> consent-gated: gen image -> animate, critic-gated, labeled

Every attempt + verdict is written to B2 under
  trips/{trip_id}/generations/scenes/scene-{idx}/attempt-{n}.json
  trips/{trip_id}/evaluations/{job_id}/scene-{idx}-verdicts.jsonl
so the lineage the passport shows is the lineage that actually happened.
"""
from __future__ import annotations

import json
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

from genblaze import AgentLoop, ThresholdEvaluator

from app.config.settings import settings
from app.media import pipelines
from app.reasoning.critic import critique_scene
from app.runtime.events import emit_job_event


def _work(job_id: str) -> Path:
    d = Path(tempfile.gettempdir()) / f"wanderos-render-{job_id}"
    d.mkdir(exist_ok=True)
    return d


def _ffmpeg(args: list[str], stage: str, timeout: int = 300) -> None:
    try:
        subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args],
                       capture_output=True, text=True, timeout=timeout, check=True)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"ffmpeg {stage}: {(exc.stderr or '').strip()[:300]}") from exc


def _fetch_asset(url_or_key: str, dest: Path) -> Path | None:
    """Download a B2 key or URL to dest. mock:// URLs return None (no real bytes)."""
    try:
        url = url_or_key
        if not url.startswith(("http://", "https://")):
            if not settings.b2_configured:
                return None
            url = pipelines.presign(url_or_key)
        if url.startswith("mock://"):
            return None
        with urllib.request.urlopen(url, timeout=120) as r:
            dest.write_bytes(r.read())
        return dest if dest.stat().st_size > 0 else None
    except Exception:
        return None


def _placeholder_clip(out: Path, seconds: int, label: str) -> Path:
    """Honest mock-tier stand-in: a labeled test pattern, never passed off as real."""
    _ffmpeg(["-f", "lavfi", "-i",
             f"testsrc2=duration={seconds}:size=1280x720:rate=24", "-pix_fmt", "yuv420p",
             str(out)], f"placeholder-{label}")
    return out


def _still_clip(photo: Path, out: Path, seconds: int) -> Path:
    _ffmpeg(["-loop", "1", "-i", str(photo), "-t", str(seconds),
             "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2",
             "-pix_fmt", "yuv420p", str(out)], "still-clip")
    return out


def _parallax_clip(photo: Path, out: Path, seconds: int) -> Path:
    """The free ffmpeg motion path: slow push-in zoompan on the real photo."""
    frames = seconds * 24
    _ffmpeg(["-loop", "1", "-i", str(photo),
             "-vf", (f"scale=2560:1440:force_original_aspect_ratio=increase,"
                     f"crop=2560:1440,zoompan=z='min(zoom+0.0008,1.25)':d={frames}"
                     f":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720:fps=24"),
             "-t", str(seconds), "-pix_fmt", "yuv420p", str(out)], "parallax")
    return out


def _record(trip_id: str, key: str, doc: dict) -> None:
    if not settings.b2_configured:
        return
    try:
        pipelines._backend().put(f"trips/{trip_id}/{key}",
                                 json.dumps(doc, default=str).encode(),
                                 content_type="application/json")
    except Exception:
        pass  # lineage record failure must not kill the render; job log still has it


def _first_asset(result, kind: str) -> str | None:
    run = getattr(result, "run", result)
    for step in getattr(run, "steps", []) or []:
        for a in getattr(step, "assets", []) or []:
            if kind in (a.media_type or ""):
                return a.url
    return None


def _first_video_asset(result) -> str | None:
    return _first_asset(result, "video")


def _generated_clip(job_id: str, trip_id: str, scene: dict, image_key: str | None,
                    out: Path) -> tuple[Path | None, list[dict]]:
    """hero_video / synthetic_scene path: AgentLoop(generate -> critique -> repair)."""
    idx = scene["idx"]
    seconds = int(scene.get("durationSec", 5))
    models = pipelines.models()
    attempts: list[dict] = []
    # Video generation needs GMI Cloud (Bedrock has no ACTIVE video model). Without
    # it the scene still gets real AI generation — Bedrock image + ffmpeg parallax.
    video_available = bool(settings.gmi_api_key) and settings.pipeline_tier != "mock"
    state = {"n": 0, "feedback": None,
             "model": models["video"] if video_available else models["image"]}

    def factory(ctx):
        state["n"] += 1
        fb = getattr(getattr(ctx, "last_evaluation", None), "feedback", None)
        prompt = scene.get("motionPrompt") or scene.get("genPrompt") or "cinematic scene"
        if fb:
            try:
                patch = json.loads(fb)
                if patch.get("strategy") == "SWITCH_MODEL" and models["video_fallbacks"]:
                    state["model"] = models["video_fallbacks"][0]
                if patch.get("prompt_patch"):
                    prompt = f"{prompt}\nRepair instructions: {patch['prompt_patch']}"
            except (json.JSONDecodeError, TypeError):
                prompt = f"{prompt}\nRepair instructions: {fb}"
        # Record the model that actually runs this attempt — the verdict and the
        # provenance record must name the real one, not the route we defaulted to.
        use_video = video_available and bool(image_key)
        if not use_video:
            state["model"] = models["image"]
        emit_job_event(job_id, "scene.attempt.started",
                       {"scene": idx, "attempt": state["n"], "model": state["model"]})
        tag = f"{job_id}-s{idx}a{state['n']}"
        if use_video:
            return pipelines.build_animate_scene(tag, image_key, prompt, seconds)
        # Image route: image-to-image when we have the traveler's real photo
        # (enhancement, not fabrication), text-to-image otherwise.
        return pipelines.build_enhance_image(tag, image_key or "", prompt)

    def score(result) -> float:
        url = _first_video_asset(result)
        suffix = "mp4"
        if url is None:
            url, suffix = _first_asset(result, "image"), "png"
        media = _fetch_asset(url, _work(job_id) / f"s{idx}a{state['n']}.{suffix}") if url else None
        verdict = critique_scene(scene, media, attempt=state["n"])
        verdict["attempt"], verdict["model"], verdict["asset_url"] = state["n"], state["model"], url
        attempts.append(verdict)
        _record(trip_id, f"generations/scenes/scene-{idx}/attempt-{state['n']}.json", verdict)
        emit_job_event(job_id, "scene.critic.verdict",
                       {"scene": idx, "attempt": state["n"], "decision": verdict["decision"],
                        "overall": verdict["overall"], "critic": verdict["critic"],
                        "violations": verdict["violations"]})
        return float(verdict["overall"])

    def feedback(result, s) -> str:
        return json.dumps(attempts[-1]["retry"]) if attempts else ""

    evaluator = ThresholdEvaluator(score_fn=score, threshold=settings.critic_threshold,
                                   feedback_fn=feedback)
    max_attempts = 1 if settings.pipeline_tier == "mock" else settings.max_scene_attempts
    loop_result = AgentLoop(factory, evaluator, max_iterations=max_attempts).run()

    # NEVER auto-accept an exhausted loop. Shipping the last rejected attempt
    # because we ran out of retries would contradict the whole trust thesis —
    # the critic said this output is wrong, and delivering it anyway makes the
    # critic theatre. The safe fallback is the traveller's OWN photo with free
    # parallax motion: always real, always accurate, never a fabrication.
    if not loop_result.passed:
        worst = attempts[-1] if attempts else {}
        emit_job_event(job_id, "scene.degraded.critic_exhausted", {
            "scene": idx,
            "attempts": len(attempts),
            "last_score": worst.get("overall"),
            "reason": (worst.get("violations") or ["critic never accepted an attempt"])[0],
        })
        real = _fetch_asset(scene.get("assetKey"), _work(job_id) / f"src_{idx:02d}.jpg") \
            if scene.get("assetKey") else None
        if real is not None:
            _parallax_clip(real, out, seconds)
        else:
            # No real photo to fall back to (a purely synthetic scene). Drop the
            # scene rather than ship something the critic rejected.
            _record(trip_id, f"evaluations/{job_id}/scene-{idx}-verdicts.jsonl",
                    {"jsonl": "\n".join(json.dumps(a, default=str) for a in attempts)})
            return None, attempts
        for a in attempts:
            a["degraded"] = True
        _record(trip_id, f"evaluations/{job_id}/scene-{idx}-verdicts.jsonl",
                {"jsonl": "\n".join(json.dumps(a, default=str) for a in attempts)})
        return out, attempts

    final = loop_result.final
    url = _first_video_asset(final)
    media = _fetch_asset(url, out) if url else None
    if media is None:
        # No video asset. Bedrock has no ACTIVE video model, so the honest path is
        # the real generated still + the free ffmpeg parallax move — a genuine
        # scene, not a placeholder. Placeholder only if there is no image either.
        image_url = _first_asset(final, "image")
        still = _fetch_asset(image_url, _work(job_id) / f"gen_{idx:02d}.png") if image_url else None
        if still is not None:
            emit_job_event(job_id, "scene.degraded.parallax",
                           {"scene": idx, "reason": "no video model available; animating generated still"})
            _parallax_clip(still, out, seconds)
        else:
            _placeholder_clip(out, seconds, f"scene-{idx}")
    verdicts_jsonl = "\n".join(json.dumps(a, default=str) for a in attempts)
    _record(trip_id, f"evaluations/{job_id}/scene-{idx}-verdicts.jsonl",
            {"jsonl": verdicts_jsonl})
    return out, attempts


def render_scene(job_id: str, trip_id: str, scene: dict,
                 consents: dict | None = None) -> dict:
    """Returns {idx, clip (Path), synthetic, attempts, skipped}."""
    idx = scene["idx"]
    seconds = int(scene.get("durationSec", 5))
    source = scene.get("source", "original")
    work = _work(job_id)
    out = work / f"clip_{idx:02d}.mp4"

    if scene.get("needsConsent") and not (consents or {}).get(str(idx), False):
        emit_job_event(job_id, "scene.skipped.no_consent", {"scene": idx})
        return {"idx": idx, "clip": None, "synthetic": True, "attempts": [], "skipped": True}

    photo = None
    if scene.get("assetKey"):
        photo = _fetch_asset(scene["assetKey"], work / f"photo_{idx:02d}.jpg")

    attempts: list[dict] = []
    if source == "original":
        _still_clip(photo, out, seconds) if photo else _placeholder_clip(out, seconds, "original")
    elif source == "parallax":
        _parallax_clip(photo, out, seconds) if photo else _placeholder_clip(out, seconds, "parallax")
    else:  # gen_image / hero_video / synthetic_scene — real generation + critic loop
        out, attempts = _generated_clip(job_id, trip_id, scene,
                                        scene.get("assetKey"), out)
        if out is None:
            # Critic never accepted and there was no real photo to fall back to.
            # Dropping the scene is the honest outcome — the film is shorter, but
            # it contains nothing the critic judged wrong.
            emit_job_event(job_id, "scene.dropped",
                           {"scene": idx, "reason": "critic rejected every attempt"})
            return {"idx": idx, "clip": None, "synthetic": True,
                    "attempts": attempts, "skipped": True, "dropped": True}

    degraded = any(a.get("degraded") for a in attempts)
    emit_job_event(job_id, "scene.completed",
                   {"scene": idx, "source": source, "attempts": len(attempts),
                    "degraded": degraded})
    return {"idx": idx, "clip": out, "synthetic": source == "synthetic_scene",
            "degraded": degraded,
            "attempts": attempts, "skipped": False}
