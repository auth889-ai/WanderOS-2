"""Real street-network routing, via OSRM (BSD-2, public demo server, no key).

The itinerary validator was estimating travel from great-circle distance and a
guessed speed. Straight-line distance is systematically wrong in cities: the
Louvre to the Eiffel Tower is 3.16 km as the crow flies and **4.04 km on the
actual street network** — a 28% underestimate, and it compounds across a day.
Underestimating travel is precisely how an itinerary becomes unexecutable, which
is the whole failure this validator exists to catch.

**A trap found while building this, worth stating plainly:** the public OSRM
demo server *ignores the routing profile*. `/foot/`, `/bike/` and `/driving/`
return byte-identical distance AND duration — roughly 24 km/h, a car speed.
Trusting its duration would have told travellers a 4 km walk takes 10 minutes.

So this uses OSRM for what it genuinely provides — the real routed DISTANCE —
and applies our own per-mode speeds to it. Every result says which parts came
from OSRM and which from us, because a number whose provenance is unclear is
how the previous version was wrong without anyone noticing.

Falls back to great-circle with an urban detour factor when OSRM is unreachable,
labelled as an estimate. A missing router degrades the estimate, never the run.
"""
from __future__ import annotations

import json
import logging
import time
import urllib.request
from dataclasses import dataclass
from functools import lru_cache

from app.common.geo import great_circle_km

logger = logging.getLogger(__name__)

OSRM_URL = "https://router.project-osrm.org/route/v1"

# Realistic door-to-door speeds over ROUTED distance, ours not OSRM's.
# Lower than raw travel speed on purpose: these include the walk to the stop,
# waiting, and the walk at the other end, which is what actually consumes a day.
MODE_SPEED_KMH = {
    "walk": 4.5,
    "bike": 13.0,
    "transit": 16.0,     # includes waiting and interchange
    "car": 25.0,         # urban, includes parking
    "taxi": 22.0,
    "intercity": 65.0,
}
# Street distance vs straight line when routing is unavailable. 1.3 is the
# widely used urban circuity factor; measured 1.28 on the Paris pair above.
DETOUR_FACTOR = 1.3
# OSRM's profile is ignored by the demo server, so we always ask for the one
# profile it actually computes and derive time ourselves.
OSRM_PROFILE = "driving"


@dataclass
class Leg:
    distance_km: float
    minutes: float
    mode: str
    distance_source: str      # "osrm" | "great_circle_estimate"
    duration_source: str      # always ours — see the module docstring
    note: str = ""

    def as_dict(self) -> dict:
        return dict(self.__dict__)


def _osrm_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float | None:
    """Routed street distance in km, or None. Never raises."""
    url = (f"{OSRM_URL}/{OSRM_PROFILE}/{lon1},{lat1};{lon2},{lat2}"
           f"?overview=false&alternatives=false")
    request = urllib.request.Request(
        url, headers={"User-Agent": "WanderOS/1.0 (itinerary validation)"})
    for attempt in range(2):
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                payload = json.load(response)
            if payload.get("code") != "Ok" or not payload.get("routes"):
                return None
            return payload["routes"][0]["distance"] / 1000.0
        except Exception as exc:
            if attempt:
                logger.info("OSRM unavailable, falling back to estimate: %s", exc)
                return None
            time.sleep(1.0)
    return None


@lru_cache(maxsize=2048)
def _cached_leg(lat1: float, lon1: float, lat2: float, lon2: float, mode: str) -> Leg:
    speed = MODE_SPEED_KMH.get(mode, MODE_SPEED_KMH["transit"])
    routed = _osrm_distance_km(lat1, lon1, lat2, lon2)

    if routed is not None:
        return Leg(
            distance_km=round(routed, 3),
            minutes=round(routed / speed * 60, 1),
            mode=mode,
            distance_source="osrm",
            duration_source=f"wanderos ({speed} km/h door-to-door for {mode})",
            note="OSRM's own duration is discarded: its public server returns the "
                 "same ~24 km/h for every profile, including walking",
        )

    straight = great_circle_km(lat1, lon1, lat2, lon2)
    estimated = straight * DETOUR_FACTOR
    return Leg(
        distance_km=round(estimated, 3),
        minutes=round(estimated / speed * 60, 1),
        mode=mode,
        distance_source="great_circle_estimate",
        duration_source=f"wanderos ({speed} km/h for {mode})",
        note=f"router unreachable — straight line {straight:.2f} km x {DETOUR_FACTOR} "
             "urban detour factor",
    )


def leg(lat1: float, lon1: float, lat2: float, lon2: float, *, mode: str = "transit") -> Leg:
    """Travel between two points. Cached — the same hop recurs across a plan."""
    return _cached_leg(round(lat1, 5), round(lon1, 5), round(lat2, 5), round(lon2, 5), mode)


def travel_minutes(lat1: float, lon1: float, lat2: float, lon2: float,
                   *, mode: str = "transit") -> float:
    return leg(lat1, lon1, lat2, lon2, mode=mode).minutes
