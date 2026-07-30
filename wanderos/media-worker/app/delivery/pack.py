"""Delivery Pack — one trip, many usable outputs.

A single 16:9 film is not what people actually do with a trip. They post a
vertical clip, they send a link to family, and (for operators) they need a
branded asset they can reuse. Producing all of it from the ALREADY-GENERATED
scenes costs no extra model spend — it is ffmpeg work over assets we own — which
is why this is the cheapest large increase in real usefulness available.

  memory-film.mp4    16:9 cinematic, the keepsake
  social-reel.mp4    9:16 with burned captions, for Instagram/TikTok
  journal.json       the trip written out, with what each moment is based on
  cover.jpg          thumbnail / share-card image

Everything lands in B2 under trips/{trip_id}/delivery/ so the share page and the
passport both read from the same durable place.
"""
from __future__ import annotations

import json
from pathlib import Path

from app.config.settings import settings
from app.media.captions import text_png
from app.media.ffmpeg import run_ffmpeg


def build_social_reel(film: Path, out: Path, *, title: str, seconds: int = 30) -> Path:
    """9:16 crop of the film with a burned title card.

    Centre-crop rather than letterbox: black bars read as lazy on a phone, and
    travel footage survives a centre crop better than most content.
    """
    title_png = text_png(title, out.parent / "reel_title.png", size=52, bg=(0, 0, 0, 0))
    run_ffmpeg(
        ["-i", str(film), "-i", str(title_png), "-t", str(seconds),
         "-filter_complex",
         "[0]scale=-2:1920,crop=1080:1920,setsar=1[v];[v][1]overlay=(W-w)/2:180",
         "-c:a", "copy", "-pix_fmt", "yuv420p", str(out)],
        stage="social-reel",
    )
    return out


def build_cover(film: Path, out: Path) -> Path:
    """Share-card still, taken a beat in so it is never a black first frame."""
    run_ffmpeg(["-ss", "2", "-i", str(film), "-frames:v", "1", "-q:v", "3", str(out)],
                stage="cover")
    return out


def build_journal(storyboard: dict, claims: list[dict], scenes: list[dict]) -> dict:
    """The trip written out — each moment carries what it is based on.

    This is the readable counterpart to the passport: the passport proves the
    production history, the journal tells the story and says plainly which
    moments were photographed and which were recreated with permission.
    """
    by_status = {c.get("id"): c for c in claims}
    entries = []
    for scene in storyboard.get("scenes", []):
        idx = scene.get("idx")
        record = next((s for s in scenes if s.get("idx") == idx), {})
        claim = by_status.get(scene.get("claimId"))
        entries.append({
            "idx": idx,
            "narration": scene.get("narrationLine"),
            "basis": (
                "recreated with your permission" if scene.get("source") == "synthetic_scene"
                else "your own photo" if scene.get("source") in ("original", "parallax")
                else "generated from your photo"
            ),
            "disclosed": scene.get("source") == "synthetic_scene",
            "evidence": (claim or {}).get("evidence", []),
            "attempts": len(record.get("attempts", []) or []),
            "skipped": record.get("skipped", False),
        })
    verified = [c for c in claims if c.get("status") == "VERIFIED"]
    confirmed = [c for c in claims if c.get("status") == "USER_CONFIRMED"]
    return {
        "title": storyboard.get("title"),
        "narration": storyboard.get("narrationFull"),
        "moments": entries,
        "summary": {
            "photographed_moments": len(verified),
            "confirmed_by_you": len(confirmed),
            "recreated_scenes": sum(1 for e in entries if e["disclosed"]),
        },
    }


def estimate_cost(scenes: list[dict]) -> dict:
    """What this film cost to make.

    Rough per-attempt figures, and labelled as estimates — an operator needs a
    number to price against, and a wrong-but-honest estimate beats no number.
    Rejected attempts are counted: they were really paid for.
    """
    per_attempt = {"image": 0.04, "video": 0.35}
    total, attempts, rejected = 0.0, 0, 0
    for scene in scenes:
        for a in scene.get("attempts", []) or []:
            attempts += 1
            if a.get("decision") == "REJECT":
                rejected += 1
            model = str(a.get("model", ""))
            total += per_attempt["video"] if any(
                k in model for k in ("kling", "sora", "seedance", "ray")
            ) else per_attempt["image"]
    return {
        "estimated_usd": round(total, 2),
        "attempts": attempts,
        "rejected_attempts": rejected,
        "wasted_on_rejects_usd": round(total * (rejected / attempts), 2) if attempts else 0.0,
        "note": "Estimated from per-attempt list prices, including rejected attempts.",
    }


def publish(trip_id: str, job_id: str, artifacts: dict[str, Path], journal: dict,
            cost: dict) -> dict:
    """Upload the pack to B2 and return the keys the UI reads."""
    keys: dict[str, str] = {}
    if not settings.b2_configured:
        return {"keys": keys, "stored": False}
    from app.media import pipelines

    backend = pipelines._backend()
    for name, path in artifacts.items():
        if path is None or not Path(path).exists():
            continue
        key = f"trips/{trip_id}/delivery/{job_id}-{name}{Path(path).suffix}"
        content = "video/mp4" if Path(path).suffix == ".mp4" else "image/jpeg"
        try:
            backend.put(key, Path(path).read_bytes(), content_type=content)
            keys[name] = key
        except Exception:
            continue
    for name, doc in (("journal", journal), ("cost", cost)):
        key = f"trips/{trip_id}/delivery/{job_id}-{name}.json"
        try:
            backend.put(key, json.dumps(doc, indent=2).encode(),
                        content_type="application/json")
            keys[name] = key
        except Exception:
            continue
    return {"keys": keys, "stored": True}
