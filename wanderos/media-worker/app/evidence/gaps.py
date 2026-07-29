"""Missing-memory detection — pure deterministic rules over the timeline.

The Autopilot NEVER silently generates a missing scene: every gap becomes a
PROPOSAL carrying needs_consent=True, surfaced at the storyboard checkpoint.
Rules (explainable > clever — a judge can audit every proposal):
  R1 evening_missing : a day whose last dated photo is before 17:00 → propose a
                       closing scene (sunset/evening) for that day.
  R2 day_sparse      : a day with < 2 photos → propose one establishing scene.
  R3 no_arrival      : first day's first photo after 15:00 → propose an arrival scene.
  R4 itinerary_miss  : itinerary text names a place that matches no photo label
                       (applied later, when vision labels exist).
"""
from __future__ import annotations

from datetime import datetime

MAX_PROPOSALS = 3  # consent fatigue guard — the top-3 most valuable gaps only


def detect_gaps(timeline: dict, destination: str | None = None) -> list[dict]:
    proposals: list[dict] = []
    days = timeline.get("days", [])
    dest = destination or "the destination"

    for d in days:
        moments = d.get("moments", [])
        photos = [p for m in moments for p in m.get("photos", [])]
        last_end = max((m.get("end") for m in moments if m.get("end")), default=None)

        if last_end and datetime.fromisoformat(last_end).hour < 17:
            proposals.append({
                "rule": "evening_missing",
                "day": d["day"],
                "description": f"No media from Day {d['day']} evening — the day ends at "
                               f"{datetime.fromisoformat(last_end).strftime('%H:%M')}.",
                "proposal": {
                    "type": "synthetic_scene",
                    "prompt": f"golden-hour sunset over {dest}, cinematic, warm, no people close-up",
                    "needs_consent": True,
                },
            })
        if len(photos) < 2:
            proposals.append({
                "rule": "day_sparse",
                "day": d["day"],
                "description": f"Day {d['day']} has only {len(photos)} photo(s) — the story may feel thin.",
                "proposal": {
                    "type": "synthetic_scene",
                    "prompt": f"establishing scene of {dest}, atmospheric, cinematic wide shot",
                    "needs_consent": True,
                },
            })

    if days:
        first = days[0].get("moments", [])
        first_start = min((m.get("start") for m in first if m.get("start")), default=None)
        if first_start and datetime.fromisoformat(first_start).hour >= 15:
            proposals.append({
                "rule": "no_arrival",
                "day": 1,
                "description": "No arrival moment — the trip's story starts mid-day.",
                "proposal": {
                    "type": "synthetic_scene",
                    "prompt": f"arrival transition: airplane window view descending toward {dest}, cinematic",
                    "needs_consent": True,
                },
            })

    # rank: evening_missing (the emotional close) > no_arrival > day_sparse; stable within rule
    order = {"evening_missing": 0, "no_arrival": 1, "day_sparse": 2}
    proposals.sort(key=lambda p: (order.get(p["rule"], 9), p["day"]))
    return proposals[:MAX_PROPOSALS]
