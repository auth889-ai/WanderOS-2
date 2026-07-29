"""WanderOS Autopilot media-worker — FastAPI service running the Genblaze engine.

Endpoints (Phase 2 surface; the orchestrating LangGraph calls these):
  GET  /health                     liveness + tier + b2 status
  POST /pipelines/enhance          {job_id, trip_id, photo_key, prompt}
  POST /pipelines/animate          {job_id, trip_id, image_key, motion_prompt, duration?, aspect_ratio?}
  POST /pipelines/narrate          {job_id, trip_id, text}
  GET  /runs/{job_id}/events       drain buffered events (polling fallback when SSE drops)
"""
from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel, Field

from app.config.settings import settings
from app.media import pipelines
from app.runtime.events import drain_local_events

app = FastAPI(title="wanderos-media-worker", version="0.1.0")


class EnhanceReq(BaseModel):
    job_id: str
    trip_id: str
    photo_key: str
    prompt: str = Field(min_length=3)


class AnimateReq(BaseModel):
    job_id: str
    trip_id: str
    image_key: str
    motion_prompt: str = Field(min_length=3)
    duration: int = 5
    aspect_ratio: str = "16:9"


class NarrateReq(BaseModel):
    job_id: str
    trip_id: str
    text: str = Field(min_length=3)


def _summarize(result) -> dict:
    run = getattr(result, "run", result)
    steps = getattr(run, "steps", []) or []
    assets = []
    for s in steps:
        for a in getattr(s, "assets", []) or []:
            assets.append({"asset_id": a.asset_id, "url": a.url, "sha256": a.sha256, "media_type": a.media_type})
    return {
        "run_id": str(getattr(run, "run_id", "")),
        "status": str(getattr(run, "status", "")),
        "steps": len(steps),
        "assets": assets,
    }


@app.get("/health")
def health():
    """Judge-facing capability report — every claim on this page is probed live."""
    from app.reasoning.claude import describe as claude_route
    from app.media.provider_catalog import chain_summary

    return {
        "ok": True,
        "tier": settings.pipeline_tier,
        "b2_configured": settings.b2_configured,
        "reasoner": claude_route(),
        "provider_chains": chain_summary(),
    }


# ── Evidence + truth model (the consent gate) ──

class EvidenceReq(BaseModel):
    job_id: str
    assets: list[dict]  # [{key, url, kind: photo|document|voice}]
    timeline: dict | None = None


@app.post("/evidence/classify")
def evidence_classify(req: EvidenceReq):
    """Extract multi-modal evidence, then classify every claim by provable status.

    Returns the consent questions the traveler must answer before any moment they
    did not photograph can be recreated.
    """
    from app.evidence.extractors import extract_all
    from app.evidence.truth import classify, consent_questions

    bundle = extract_all(req.assets, job_id=req.job_id)
    result = classify(bundle, req.timeline)
    return {
        "evidence": bundle,
        "claims": result["claims"],
        "classifier": result["classifier"],
        "degraded": result["degraded"],
        "consent_questions": consent_questions(result["claims"]),
    }


class ConsentReq(BaseModel):
    claims: list[dict]
    decisions: dict[str, str]  # claim id -> confirmed | denied | unsure


@app.post("/evidence/consent")
def evidence_consent(req: ConsentReq):
    """Fold the traveler's answers in and report what may now be generated."""
    from app.evidence.truth import apply_consent, disclosure_required, may_generate

    claims = apply_consent(req.claims, req.decisions)
    return {
        "claims": claims,
        "generatable": [c["id"] for c in claims if may_generate(c)],
        "requires_disclosure": [c["id"] for c in claims if disclosure_required(c)],
    }


@app.post("/pipelines/enhance")
def enhance(req: EnhanceReq):
    p = pipelines.build_enhance_image(req.job_id, req.photo_key, req.prompt)
    return _summarize(pipelines.run_pipeline(p, req.trip_id))


@app.post("/pipelines/animate")
def animate(req: AnimateReq):
    p = pipelines.build_animate_scene(req.job_id, req.image_key, req.motion_prompt, req.duration, req.aspect_ratio)
    return _summarize(pipelines.run_pipeline(p, req.trip_id))


@app.post("/pipelines/narrate")
def narrate(req: NarrateReq):
    p = pipelines.build_narrate(req.job_id, req.text)
    return _summarize(pipelines.run_pipeline(p, req.trip_id))


@app.get("/runs/{job_id}/events")
def run_events(job_id: str):
    return {"events": drain_local_events(job_id)}


class TimelineReq(BaseModel):
    photos: list[dict]  # [{key, url}] — presigned B2 URLs (or any fetchable URL in tests)


@app.post("/analyze/timeline")
async def analyze_timeline(req: TimelineReq):
    from app.evidence.timeline import analyze_photos

    return await analyze_photos(req.photos)


class GapsReq(BaseModel):
    timeline: dict
    destination: str | None = None


@app.post("/analyze/gaps")
def analyze_gaps(req: GapsReq):
    from app.evidence.gaps import detect_gaps

    return {"gaps": detect_gaps(req.timeline, req.destination)}


# ── Render jobs (P5/P6): generation engine + critic loop + compose + seal ──

class RenderReq(BaseModel):
    job_id: str
    trip_id: str
    storyboard: dict  # approved Storyboard (schema.ts shape)
    consents: dict[str, bool] = {}  # {"<scene idx>": true} for synthetic scenes


@app.post("/jobs/render")
def create_render(req: RenderReq):
    from app.jobs.render_job import get_job, start_render

    existing = get_job(req.job_id)
    if existing and existing["status"] not in ("failed",):
        return existing  # idempotent: re-POST returns the live job, never double-renders
    return start_render(req.job_id, req.trip_id, req.storyboard, req.consents)


@app.get("/jobs/{job_id}")
def job_status(job_id: str):
    from fastapi import HTTPException

    from app.jobs.render_job import get_job

    job = get_job(job_id)
    if job is None:
        raise HTTPException(404, "unknown render job")
    return job


@app.get("/jobs/{job_id}/verify")
def job_verify(job_id: str):
    """The three independent checks against the sealed film — the /verify beat."""
    from pathlib import Path

    from fastapi import HTTPException

    from app.jobs.render_job import get_job
    from app.trust.sealing import verify_film

    job = get_job(job_id)
    if not job or "publish_record" not in job:
        raise HTTPException(404, "no sealed film for this job")
    record = job["publish_record"]
    return verify_film(Path(record["sealed_path"]), record)
