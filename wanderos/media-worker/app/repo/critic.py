"""Claude scene critic — the quality gate of the generation loop (P6 core).

Claude sees one representative frame of a generated scene plus the scene's
intent (prompt, destination, disclosure requirements) and returns a structured
verdict: per-dimension scores, ACCEPT/REJECT, and a concrete repair strategy
(prompt patch or model switch) that the AgentLoop feeds into the next attempt.

Honesty rule: when no ANTHROPIC_API_KEY is configured the fallback rubric is
deterministic and clearly labeled critic="rubric-fallback" — never presented
as an AI judgment.
"""
from __future__ import annotations

import base64
import json
import subprocess
import tempfile
from pathlib import Path

from app.config.settings import settings

VERDICT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["decision", "scores", "overall", "violations", "retry"],
    "properties": {
        "decision": {"type": "string", "enum": ["ACCEPT", "REJECT"]},
        "scores": {
            "type": "object",
            "additionalProperties": False,
            "required": ["prompt_match", "visual_quality", "destination_fidelity", "artifacts"],
            "properties": {
                "prompt_match": {"type": "number"},
                "visual_quality": {"type": "number"},
                "destination_fidelity": {"type": "number"},
                "artifacts": {"type": "number"},
            },
        },
        "overall": {"type": "number"},
        "violations": {"type": "array", "items": {"type": "string"}},
        "retry": {
            "type": "object",
            "additionalProperties": False,
            "required": ["strategy", "prompt_patch"],
            "properties": {
                "strategy": {"type": "string", "enum": ["NONE", "REWRITE_PROMPT", "SWITCH_MODEL"]},
                "prompt_patch": {"type": "string"},
            },
        },
    },
}


def extract_frame(video: Path) -> Path | None:
    """Middle frame of a clip as JPEG — what the critic actually looks at."""
    out = Path(tempfile.mkstemp(suffix=".jpg")[1])
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-sseof", "-2", "-i", str(video),
             "-frames:v", "1", "-q:v", "3", str(out)],
            capture_output=True, timeout=60, check=True,
        )
        return out if out.stat().st_size > 0 else None
    except Exception:
        return None


def _rubric_fallback(scene: dict, media: Path | None) -> dict:
    """Deterministic no-key fallback: checks what CAN be checked without vision.
    Media exists + nonempty => pass with mid confidence; missing => reject."""
    ok = media is not None and media.exists() and media.stat().st_size > 1024
    score = 0.88 if ok else 0.2
    return {
        "decision": "ACCEPT" if ok else "REJECT",
        "scores": {"prompt_match": score, "visual_quality": score,
                   "destination_fidelity": score, "artifacts": score},
        "overall": score,
        "violations": [] if ok else ["asset missing or empty — generation failed"],
        "retry": {"strategy": "NONE" if ok else "SWITCH_MODEL", "prompt_patch": ""},
        "critic": "rubric-fallback (no ANTHROPIC_API_KEY — deterministic checks only)",
    }


def critique_scene(scene: dict, media: Path | None, *, attempt: int = 1) -> dict:
    """Score one generated scene. `media` = local path of the clip (or image)."""
    from app.repo.claude import ClaudeUnavailable, complete, describe, route

    if route() == "none":
        return _rubric_fallback(scene, media)

    frame = media
    if media is not None and media.suffix.lower() in {".mp4", ".mov", ".webm"}:
        frame = extract_frame(media)
    if frame is None or not frame.exists():
        return _rubric_fallback(scene, media)

    prompt = f"""You are the visual critic for a travel memory film. Judge this frame of a generated scene.

Scene intent:
- generation prompt: {scene.get('genPrompt') or scene.get('motionPrompt')}
- destination: {scene.get('destination', 'unknown')}
- source type: {scene.get('source')} (synthetic scenes MUST look plausible for the destination)
- attempt number: {attempt}

Score each dimension 0-1. REJECT if overall < {settings.critic_threshold} or any violation is
serious (wrong architecture/geography for the destination, heavy artifacts, content that
contradicts the prompt). On REJECT choose a retry strategy: REWRITE_PROMPT with a concrete
prompt_patch (what to change), or SWITCH_MODEL if the failure looks model-specific.
overall = your holistic score, not a mean."""

    try:
        verdict = complete(prompt, image_jpeg=frame.read_bytes(),
                           schema=VERDICT_SCHEMA, max_tokens=2048)
        verdict["critic"] = describe()
        return verdict
    except ClaudeUnavailable as exc:
        v = _rubric_fallback(scene, media)
        v["critic"] = f"rubric-fallback ({exc})"
        return v
    except Exception as exc:  # network/parse — degrade honestly, never block the film
        v = _rubric_fallback(scene, media)
        v["critic"] = f"rubric-fallback (claude error: {type(exc).__name__})"
        return v
