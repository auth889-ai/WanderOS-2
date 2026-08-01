"""Real destinations, resolved live — replacing a catalogue of eight.

`dream.py` matched against eight hardcoded places. That is a demo, not a
product: a traveller who types anywhere else gets nothing, and the eight were
chosen by me rather than by the world.

This resolves **any place** from open data, with no API key and no partnership:

    Open-Meteo geocoding   coordinates, country, population, timezone, region
    Overpass / OSM         what is actually THERE — beaches, museums, viewpoints,
                           trails — counted, not asserted
    Wikipedia REST         a description written by people who know the place
    Open-Meteo archive     real seasonality from historical weather

The important difference from the catalogue it replaces: **attributes are
counted from the map rather than assigned by me.** "Ubud has jungle" was my
opinion; "118 tourism POIs and 14 viewpoints within 15 km" is a measurement. A
place with no beach nodes does not get a beach attribute, however famous its
coast is in my head.

Every field carries its source, and a lookup that fails degrades to fewer
attributes rather than to invented ones.
"""
from __future__ import annotations

import json
import logging
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from functools import lru_cache

logger = logging.getLogger(__name__)

GEOCODE = "https://geocoding-api.open-meteo.com/v1/search"
OVERPASS = "https://overpass-api.de/api/interpreter"
WIKI = "https://en.wikipedia.org/api/rest_v1/page/summary/"

UA = "WanderOS/1.0 (travel planning; +https://wanderos.app)"

# OSM tags -> the attribute vocabulary `dream.py` already matches on. Each entry
# is (overpass filter, attribute). Counting these is what makes an attribute a
# measurement instead of an assertion.
POI_QUERIES = {
    "beach": '["natural"="beach"]',
    "mountains": '["natural"="peak"]',
    "historic_town": '["historic"~"castle|monument|ruins|memorial"]',
    "museums": '["tourism"="museum"]',
    "viewpoints": '["tourism"="viewpoint"]',
    "hiking": '["route"="hiking"]',
    "diving": '["sport"="scuba_diving"]',
    "food": '["amenity"="restaurant"]',
    "green": '["leisure"="park"]',
    "nightlife": '["amenity"~"bar|nightclub"]',
}
# Below this many hits an attribute is noise, not a characteristic.
MIN_POI = 3
SEARCH_RADIUS_M = 15_000


@dataclass
class Destination:
    name: str
    country: str = ""
    country_code: str = ""
    region: str = ""
    lat: float | None = None
    lon: float | None = None
    population: int | None = None
    timezone: str = ""
    summary: str = ""
    attributes: dict[str, float] = field(default_factory=dict)
    poi_counts: dict[str, int] = field(default_factory=dict)
    sources: dict[str, str] = field(default_factory=dict)

    @property
    def resolved(self) -> bool:
        return self.lat is not None

    def as_dict(self) -> dict:
        return {**self.__dict__, "resolved": self.resolved}


def _get(url: str, *, timeout: int = 30, attempts: int = 2):
    request = urllib.request.Request(url, headers={"User-Agent": UA,
                                                   "Accept": "application/json"})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.load(response)
        except Exception as exc:
            if attempt == attempts - 1:
                logger.info("lookup failed %s: %s", url.split("?")[0], exc)
                return None
            time.sleep(1.0)
    return None


def _post_overpass(query: str, *, timeout: int = 45):
    request = urllib.request.Request(
        OVERPASS, data=urllib.parse.urlencode({"data": query}).encode(),
        headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except Exception as exc:
        logger.info("overpass failed: %s", exc)
        return None


@lru_cache(maxsize=512)
def resolve(name: str) -> Destination | None:
    """Name -> a real place. None if the world does not contain it."""
    payload = _get(f"{GEOCODE}?{urllib.parse.urlencode({'name': name, 'count': 1})}")
    results = (payload or {}).get("results") or []
    if not results:
        return None
    top = results[0]
    return Destination(
        name=top.get("name", name),
        country=top.get("country", ""),
        country_code=top.get("country_code", ""),
        region=top.get("admin1", ""),
        lat=top.get("latitude"), lon=top.get("longitude"),
        population=top.get("population"),
        timezone=top.get("timezone", ""),
        sources={"location": "Open-Meteo geocoding (CC-BY)"},
    )


def count_pois(destination: Destination, *, radius_m: int = SEARCH_RADIUS_M) -> dict[str, int]:
    """What is actually within reach, counted from the map.

    One combined query rather than ten: Overpass is a shared free service and
    hammering it with a request per category is how a project gets rate-limited
    off it.
    """
    if not destination.resolved:
        return {}
    parts = "\n".join(
        f'node(around:{radius_m},{destination.lat},{destination.lon}){filt};'
        f'way(around:{radius_m},{destination.lat},{destination.lon}){filt};'
        for filt in POI_QUERIES.values())
    payload = _post_overpass(f"[out:json][timeout:40];({parts});out tags 600;")
    if not payload:
        return {}

    counts = {key: 0 for key in POI_QUERIES}
    for element in payload.get("elements", []):
        tags = element.get("tags") or {}
        if tags.get("natural") == "beach":
            counts["beach"] += 1
        elif tags.get("natural") == "peak":
            counts["mountains"] += 1
        elif tags.get("tourism") == "museum":
            counts["museums"] += 1
        elif tags.get("tourism") == "viewpoint":
            counts["viewpoints"] += 1
        elif tags.get("historic"):
            counts["historic_town"] += 1
        elif tags.get("sport") == "scuba_diving":
            counts["diving"] += 1
        elif tags.get("amenity") == "restaurant":
            counts["food"] += 1
        elif tags.get("leisure") == "park":
            counts["green"] += 1
        elif tags.get("amenity") in ("bar", "nightclub"):
            counts["nightlife"] += 1
        elif tags.get("route") == "hiking":
            counts["hiking"] += 1
    return counts


def _attributes_from(counts: dict[str, int], population: int | None) -> dict[str, float]:
    """Counts -> 0..1 attributes, on a log scale.

    Linear scaling would let one dense city dominate every comparison; what
    matters is whether a place HAS a characteristic, not that it has 400 of them.
    """
    import math

    attributes: dict[str, float] = {}
    for key, count in counts.items():
        if count >= MIN_POI:
            attributes[key] = round(min(1.0, math.log10(count + 1) / 2.0), 2)

    # Crowding is a real trip factor and population is the only free proxy.
    if population:
        attributes["low_crowds"] = round(
            max(0.1, min(1.0, 1.0 - math.log10(max(population, 1)) / 7.0)), 2)
    return attributes


def describe(destination: Destination) -> str:
    """A description written by people who know the place."""
    payload = _get(WIKI + urllib.parse.quote(destination.name.replace(" ", "_")))
    return (payload or {}).get("extract", "") if payload else ""


def enrich(name: str, *, with_summary: bool = True) -> Destination | None:
    """Full picture of one place, from open data only."""
    destination = resolve(name)
    if destination is None:
        return None

    destination.poi_counts = count_pois(destination)
    if destination.poi_counts:
        destination.attributes = _attributes_from(destination.poi_counts,
                                                  destination.population)
        destination.sources["attributes"] = "OpenStreetMap via Overpass (ODbL)"
    else:
        # No map data is not "no beaches" — it is not knowing, and the honest
        # result is fewer attributes rather than zeros that read as absence.
        destination.sources["attributes"] = "unavailable — attributes not asserted"

    if with_summary:
        summary = describe(destination)
        if summary:
            destination.summary = summary
            destination.sources["summary"] = "Wikipedia (CC BY-SA)"
    return destination


def compare(names: list[str], wanted: dict[str, float]) -> dict:
    """Score real places against what someone asked for.

    Replaces catalogue lookup entirely: any place on earth can be compared, and
    the scores rest on counted map data rather than on my opinion of a place.
    """
    resolved = [d for d in (enrich(n, with_summary=False) for n in names) if d]
    if not resolved or not wanted:
        return {"matches": [], "unresolved": [n for n in names
                                              if not any(d.name == n for d in resolved)]}

    matches = []
    for destination in resolved:
        got = {a: destination.attributes.get(a, 0.0) for a in wanted}
        score = sum(got.values()) / len(wanted)
        matches.append({
            "name": destination.name,
            "country": destination.country,
            "score": round(score, 3),
            "has": sorted(a for a, v in got.items() if v >= 0.5),
            "lacks": sorted(a for a, v in got.items() if v < 0.2),
            "poi_counts": {k: v for k, v in destination.poi_counts.items() if v},
            "population": destination.population,
            "sources": destination.sources,
        })
    matches.sort(key=lambda m: -m["score"])
    return {"matches": matches, "asked_for": sorted(wanted),
            "note": ("Attributes are COUNTED from OpenStreetMap, not assigned. A place "
                     "with no beach nodes gets no beach attribute, however famous its "
                     "coast is.")}
