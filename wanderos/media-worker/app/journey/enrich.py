"""Enrichers — how a feature plugs into the twin without knowing about others.

Each enricher is the same shape:

    reads the keys it needs  ->  runs the existing module  ->  records what it learned

That shape is the whole architecture. An enricher never imports another
enricher, so adding the thirty-first feature costs one function rather than
thirty integrations. If a required key is missing it declines and says which
one, instead of inventing input — which is how the packing list ended up
demanding temperatures the caller had to guess.

The existing modules are untouched. They stay independently callable and
independently testable; enrichers are the thin layer that lets them cooperate.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date

from app.journey import twin as T

logger = logging.getLogger(__name__)


@dataclass
class Result:
    name: str
    ran: bool
    wrote: list[str]
    skipped_because: str = ""
    error: str = ""

    def as_dict(self) -> dict:
        return dict(self.__dict__)


def _needs(twin: T.Twin, name: str, *keys: str) -> Result | None:
    missing = twin.missing(*keys)
    if missing:
        return Result(name, False, [], f"needs {', '.join(missing)}")
    return None


def enrich_weather(twin: T.Twin) -> Result:
    """Real forecast or climate estimate for the actual dates."""
    blocked = _needs(twin, "weather", T.DESTINATION, T.START, T.END)
    if blocked:
        return blocked
    try:
        from app.planning.weather import for_trip

        place, window = for_trip(twin.get(T.DESTINATION),
                                 twin.get(T.START), twin.get(T.END))
        wrote = []
        if window.usable:
            # A forecast is measured; a climate estimate is inferred. The
            # distinction is the whole point of that module and it survives here.
            source = "measured" if window.kind == "forecast" else "inferred"
            twin.record(T.WEATHER, window.as_dict(), source=source, by="weather",
                        confidence=0.9 if window.kind == "forecast" else 0.6,
                        note=window.basis)
            wrote.append(T.WEATHER)
        if place and not twin.trusted(T.COUNTRY, at_least="traveller"):
            twin.record(T.COUNTRY, place.country_code, source="third_party",
                        by="weather.geocode")
            wrote.append(T.COUNTRY)
        return Result("weather", True, wrote)
    except Exception as exc:
        return Result("weather", False, [], error=f"{type(exc).__name__}: {exc}"[:160])


def enrich_packing(twin: T.Twin) -> Result:
    """Packing list built from the weather ALREADY in the twin.

    Before this, packing fetched its own weather or took temperatures as
    arguments. Two modules doing the same network call is the symptom the twin
    exists to remove.
    """
    blocked = _needs(twin, "packing", T.WEATHER, T.START, T.END)
    if blocked:
        return blocked
    try:
        from app.planning.packing import TripProfile, build_packing_list

        weather = twin.get(T.WEATHER) or {}
        start, end = twin.get(T.START), twin.get(T.END)
        profile = TripProfile(
            days=(end - start).days + 1,
            destination_country=twin.get(T.COUNTRY, ""),
            min_temp_c=weather.get("min_temp_c"),
            max_temp_c=weather.get("max_temp_c"),
            rain_expected=bool(weather.get("rain_expected")),
            travellers=twin.get(T.TRAVELLERS, 1),
        )
        twin.record(T.PACKING, build_packing_list(profile),
                    source="inferred", by="packing")
        return Result("packing", True, [T.PACKING])
    except Exception as exc:
        return Result("packing", False, [], error=f"{type(exc).__name__}: {exc}"[:160])


def enrich_true_cost(twin: T.Twin) -> Result:
    """The real bill — the #1 named traveller frustration."""
    blocked = _needs(twin, "true_cost", T.START, T.END)
    if blocked:
        return blocked
    try:
        from app.planning.true_cost import Trip, estimate

        start, end = twin.get(T.START), twin.get(T.END)
        twin.record(T.TRUE_COST, estimate(Trip(
            nights=max(1, (end - start).days),
            travellers=twin.get(T.TRAVELLERS, 1),
            headline_price=twin.get(T.BUDGET_TOTAL, 0.0) or 0.0,
        )), source="inferred", by="true_cost")
        return Result("true_cost", True, [T.TRUE_COST])
    except Exception as exc:
        return Result("true_cost", False, [], error=f"{type(exc).__name__}: {exc}"[:160])


def enrich_journey(twin: T.Twin) -> Result:
    """Route and stops from the photo timeline."""
    blocked = _needs(twin, "journey", T.TIMELINE)
    if blocked:
        return blocked
    try:
        from app.evidence.journey import build_journey

        journey = build_journey(twin.get(T.TIMELINE))
        twin.record(T.JOURNEY, {
            "stops": [{"lat": s.lat, "lon": s.lon, "place": s.label,
                       "photos": s.photos} for s in journey.stops],
            "route": journey.route, "legs_km": journey.legs_km,
            "total_km": journey.total_km,
        }, source="measured", by="journey", note="derived from photo EXIF GPS")
        return Result("journey", True, [T.JOURNEY])
    except Exception as exc:
        return Result("journey", False, [], error=f"{type(exc).__name__}: {exc}"[:160])


def enrich_corrections(twin: T.Twin) -> Result:
    """Apply the traveller's corrections over the inferred journey.

    This is where the ranking earns itself: corrections are `traveller` sourced
    and the journey is `measured`, so the correction wins — and the superseded
    journey stays in the audit rather than vanishing.
    """
    blocked = _needs(twin, "corrections", T.JOURNEY, T.CORRECTIONS)
    if blocked:
        return blocked
    try:
        from app.evidence.corrections import Correction, apply_corrections

        raw = twin.get(T.CORRECTIONS) or []
        corrections = [c if isinstance(c, Correction) else Correction(**c) for c in raw]
        result = apply_corrections(twin.get(T.JOURNEY), corrections)
        twin.record(T.JOURNEY, result["journey"], source="traveller",
                    by="corrections",
                    note=f"{len(result['applied'])} correction(s) applied")
        return Result("corrections", True, [T.JOURNEY])
    except Exception as exc:
        return Result("corrections", False, [], error=f"{type(exc).__name__}: {exc}"[:160])


def enrich_rights(twin: T.Twin) -> Result:
    """Entitlements, if a disrupted flight is on the twin."""
    blocked = _needs(twin, "rights", T.FLIGHT)
    if blocked:
        return blocked
    try:
        from datetime import datetime

        from app.rights.passenger_rights import Flight, assess

        raw = twin.get(T.FLIGHT) or {}

        def when(value):
            return datetime.fromisoformat(value) if value else None

        twin.record(T.ENTITLEMENT, assess(Flight(
            departure_airport=raw.get("departure_airport", ""),
            arrival_airport=raw.get("arrival_airport", ""),
            departure_country=raw.get("departure_country", ""),
            arrival_country=raw.get("arrival_country", ""),
            carrier_country=raw.get("carrier_country", ""),
            scheduled_arrival=when(raw.get("scheduled_arrival")),
            actual_arrival=when(raw.get("actual_arrival")),
            departure_latlon=raw.get("departure_latlon"),
            arrival_latlon=raw.get("arrival_latlon"),
            cause=raw.get("cause", "unknown"),
            disruption=raw.get("disruption", "delay"),
        )), source="official", by="passenger_rights",
            note="regulated amounts, versioned and source-linked")
        return Result("rights", True, [T.ENTITLEMENT])
    except Exception as exc:
        return Result("rights", False, [], error=f"{type(exc).__name__}: {exc}"[:160])


# Order matters only where one enricher genuinely needs another's output.
# Everything else could run in any order, which is the point.
PIPELINE = (
    enrich_weather,        # -> weather, country
    enrich_packing,        # needs weather
    enrich_true_cost,
    enrich_journey,        # needs timeline
    enrich_corrections,    # needs journey
    enrich_rights,         # needs flight
)


def run(twin: T.Twin, enrichers=PIPELINE) -> dict:
    """Run every enricher that can run. Skipping is normal, not failure.

    A trip with no flight has no entitlement; a trip with no photos has no
    journey. Reporting *why* each was skipped is what makes the twin legible —
    a caller can see exactly what the product does not yet know.
    """
    results = [enricher(twin) for enricher in enrichers]
    return {
        "trip_id": twin.trip_id,
        "ran": [r.name for r in results if r.ran],
        "skipped": {r.name: r.skipped_because for r in results
                    if not r.ran and r.skipped_because},
        "failed": {r.name: r.error for r in results if r.error},
        "facts_known": sorted(twin.facts),
        "results": [r.as_dict() for r in results],
    }
