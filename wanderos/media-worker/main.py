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
from app.repo import pipelines
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
    return {"ok": True, "tier": settings.pipeline_tier, "b2_configured": settings.b2_configured}


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
    from app.repo.timeline import analyze_photos

    return await analyze_photos(req.photos)
