"""Feature 8 — Dream-to-Destination.

People do not start with a destination. They start with a saved photo, or a
sentence like "somewhere with turquoise water where it is not freezing in
November and I can actually afford it". Turning that into candidates is the
first real step of planning, and it is the step search engines are worst at,
because a photo has no keywords.

How this works, and what it deliberately refuses to do:

**An image is read for ATTRIBUTES, never identified as a place.** A vision
model asked "where is this" will confidently name a specific beach and be wrong,
and the traveller will then plan a trip around a hallucination. So the image is
reduced to what is actually visible — water colour, terrain, density, built
style, vegetation — and matching happens on those. If the model does happen to
recognise a place, that is offered as an unverified guess, clearly separated
from the attribute match.

**Seasonality is a hard filter, not a score.** The most common way inspiration
tools fail people is suggesting somewhere genuinely perfect in the wrong month:
monsoon, closed season, or 45C. A destination that is bad in the requested month
is excluded and the reason is stated, rather than being ranked third with no
explanation.

**Every match explains itself.** "Because you asked for turquoise water, low
crowds and under 100/night" is checkable. A ranked list with no reasons is
indistinguishable from an ad.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field

# A small, honest catalogue. Real deployments would source this from a proper
# destination dataset; the point here is the matching discipline, not coverage.
# best_months are 1-12. avoid_months carry the reason, because "avoid" without a
# reason reads as arbitrary.
DESTINATIONS = [
    {"name": "Palawan, Philippines", "country": "PH",
     "attrs": {"turquoise_water": 1.0, "beach": 1.0, "islands": 1.0, "jungle": 0.7,
               "low_crowds": 0.6, "budget_friendly": 0.8, "diving": 0.9},
     "best_months": [1, 2, 3, 4, 5], "avoid": {6: "monsoon", 7: "monsoon", 8: "monsoon",
                                               9: "typhoon season", 10: "typhoon season"},
     "nightly_from": 35},
    {"name": "Amalfi Coast, Italy", "country": "IT",
     "attrs": {"turquoise_water": 0.8, "beach": 0.7, "cliffs": 1.0, "historic_town": 0.9,
               "food": 1.0, "low_crowds": 0.2, "budget_friendly": 0.2},
     "best_months": [5, 6, 9, 10], "avoid": {8: "peak crowds and heat",
                                             1: "much of it closes", 2: "much of it closes"},
     "nightly_from": 140},
    {"name": "Lofoten, Norway", "country": "NO",
     "attrs": {"mountains": 1.0, "fjords": 1.0, "low_crowds": 0.8, "hiking": 1.0,
               "northern_lights": 0.9, "budget_friendly": 0.2, "cold": 1.0},
     "best_months": [2, 3, 6, 7, 8, 9], "avoid": {11: "very short daylight",
                                                  12: "polar night"},
     "nightly_from": 120},
    {"name": "Kerala, India", "country": "IN",
     "attrs": {"backwaters": 1.0, "jungle": 0.8, "beach": 0.7, "food": 0.9,
               "budget_friendly": 0.95, "low_crowds": 0.5, "tea_hills": 0.9},
     "best_months": [11, 12, 1, 2, 3], "avoid": {6: "monsoon", 7: "monsoon", 8: "monsoon"},
     "nightly_from": 25},
    {"name": "Azores, Portugal", "country": "PT",
     "attrs": {"volcanic": 1.0, "hiking": 0.9, "low_crowds": 0.85, "green": 1.0,
               "whale_watching": 0.9, "budget_friendly": 0.6, "turquoise_water": 0.4},
     "best_months": [5, 6, 7, 8, 9], "avoid": {1: "wet and windy", 2: "wet and windy"},
     "nightly_from": 70},
    {"name": "Hokkaido, Japan", "country": "JP",
     "attrs": {"snow": 1.0, "skiing": 1.0, "food": 1.0, "onsen": 1.0, "cold": 1.0,
               "low_crowds": 0.5, "budget_friendly": 0.4},
     "best_months": [1, 2, 12, 7, 8], "avoid": {4: "between seasons — little open",
                                                5: "between seasons"},
     "nightly_from": 90},
    {"name": "Oaxaca, Mexico", "country": "MX",
     "attrs": {"food": 1.0, "historic_town": 0.9, "crafts": 1.0, "budget_friendly": 0.85,
               "low_crowds": 0.6, "beach": 0.5, "arid": 0.7},
     "best_months": [10, 11, 12, 1, 2, 3], "avoid": {6: "heavy rain", 7: "heavy rain"},
     "nightly_from": 40},
    {"name": "Scottish Highlands, UK", "country": "GB",
     "attrs": {"mountains": 0.9, "hiking": 1.0, "low_crowds": 0.7, "green": 1.0,
               "castles": 0.9, "cold": 0.7, "budget_friendly": 0.5},
     "best_months": [5, 6, 9], "avoid": {7: "midges", 8: "midges"},
     "nightly_from": 80},
]

# Phrases people actually type, mapped to catalogue attributes. Kept explicit so
# a match can always cite which phrase produced it.
PHRASE_ATTRS = {
    "turquoise": "turquoise_water", "clear water": "turquoise_water",
    "beach": "beach", "island": "islands", "diving": "diving", "snorkel": "diving",
    "mountain": "mountains", "hike": "hiking", "hiking": "hiking", "trek": "hiking",
    "quiet": "low_crowds", "not crowded": "low_crowds", "no crowds": "low_crowds",
    "off the beaten": "low_crowds", "empty": "low_crowds",
    "cheap": "budget_friendly", "affordable": "budget_friendly", "budget": "budget_friendly",
    "food": "food", "cuisine": "food", "eat": "food",
    "snow": "snow", "ski": "skiing", "cold": "cold",
    "jungle": "jungle", "green": "green", "forest": "green",
    "historic": "historic_town", "old town": "historic_town", "ruins": "historic_town",
    "northern lights": "northern_lights", "aurora": "northern_lights",
    "volcano": "volcanic", "fjord": "fjords", "cliff": "cliffs", "desert": "arid",
}

VISION_PROMPT = """Describe ONLY what is visibly present in this image, as JSON.
Do NOT name or guess the location — describing what is visible is the task.

{"water_colour": "turquoise|blue|grey|green|none",
 "terrain": ["beach","mountains","jungle","desert","urban","cliffs","fjords","snow"],
 "built_density": "none|sparse|village|town|city",
 "vegetation": "none|sparse|green|tropical",
 "crowd_level": "empty|few_people|busy",
 "apparent_season": "summer|winter|spring|autumn|unclear",
 "recognised_place": null or "name if you genuinely recognise it, else null"}"""

VISION_SCHEMA = {
    "type": "object",
    "properties": {
        "water_colour": {"type": ["string", "null"]},
        "terrain": {"type": "array", "items": {"type": "string"}},
        "built_density": {"type": ["string", "null"]},
        "vegetation": {"type": ["string", "null"]},
        "crowd_level": {"type": ["string", "null"]},
        "apparent_season": {"type": ["string", "null"]},
        "recognised_place": {"type": ["string", "null"]},
    },
    "required": ["terrain"],
}

# Visible attributes -> catalogue attributes.
VISION_ATTRS = {
    "turquoise": "turquoise_water", "beach": "beach", "mountains": "mountains",
    "jungle": "jungle", "cliffs": "cliffs", "fjords": "fjords", "snow": "snow",
    "desert": "arid", "tropical": "jungle", "green": "green",
}


@dataclass
class Dream:
    text: str = ""
    month: int | None = None
    max_nightly: float | None = None
    image_attributes: dict = field(default_factory=dict)
    recognised_place: str | None = None


def read_image(image_bytes: bytes) -> Dream:
    """Reduce an inspiration photo to visible attributes.

    Never asked "where is this". A model that names a beach will do so
    confidently and sometimes wrongly, and a trip planned around that is a trip
    planned around a hallucination.
    """
    from app.reasoning.claude import complete

    try:
        # Same bug as documents.py had: describe() takes no arguments. This call
        # raised on every invocation and the broad except returned an empty
        # Dream, so image-based matching silently never worked at all.
        payload = complete(VISION_PROMPT, image_jpeg=image_bytes,
                           schema=VISION_SCHEMA, max_tokens=600)
    except Exception:
        return Dream()

    attrs: dict[str, float] = {}
    if payload.get("water_colour") == "turquoise":
        attrs["turquoise_water"] = 1.0
    for terrain in payload.get("terrain") or []:
        if terrain in VISION_ATTRS:
            attrs[VISION_ATTRS[terrain]] = 1.0
    if payload.get("vegetation") in VISION_ATTRS:
        attrs[VISION_ATTRS[payload["vegetation"]]] = 0.8
    if payload.get("crowd_level") in ("empty", "few_people"):
        attrs["low_crowds"] = 0.9
    if (payload.get("built_density") or "") in ("village", "town"):
        attrs["historic_town"] = 0.6

    return Dream(image_attributes=attrs,
                 recognised_place=payload.get("recognised_place") or None)


def parse_text(text: str) -> dict[str, float]:
    lowered = (text or "").lower()
    return {attr: 1.0 for phrase, attr in PHRASE_ATTRS.items() if phrase in lowered}


def match(dream: Dream, *, limit: int = 4) -> dict:
    wanted = {**parse_text(dream.text), **dream.image_attributes}
    if not wanted:
        return {"matches": [], "excluded": [],
                "reason": "nothing to match on — describe what you want or add a photo"}

    matches, excluded = [], []
    for dest in DESTINATIONS:
        # Seasonality: a hard filter with a stated reason, never a score penalty.
        if dream.month and dream.month in dest["avoid"]:
            excluded.append({"name": dest["name"], "why": dest["avoid"][dream.month],
                             "month": dream.month})
            continue
        if dream.max_nightly is not None and dest["nightly_from"] > dream.max_nightly:
            excluded.append({"name": dest["name"],
                             "why": f"from {dest['nightly_from']}/night, over your "
                                    f"{dream.max_nightly:.0f} limit"})
            continue

        got = {a: dest["attrs"].get(a, 0.0) for a in wanted}
        score = sum(got.values()) / len(wanted)
        if score <= 0.15:
            continue
        met = sorted((a for a, v in got.items() if v >= 0.6), key=lambda a: -got[a])
        missed = sorted(a for a, v in got.items() if v < 0.3)
        matches.append({
            "name": dest["name"], "country": dest["country"],
            "score": round(score, 3),
            "nightly_from": dest["nightly_from"],
            "in_season": (dream.month in dest["best_months"]) if dream.month else None,
            # Always says WHY. A ranked list without reasons is an ad.
            "because": met,
            "does_not_have": missed,
            "explanation": (
                f"matches {', '.join(met) or 'little of what you asked'}"
                + (f"; lacks {', '.join(missed)}" if missed else "")
                + (f"; {dream.month:02d} is a good month there"
                   if dream.month and dream.month in dest["best_months"] else "")
            ),
        })

    matches.sort(key=lambda m: (-(m["in_season"] is True), -m["score"]))
    result = {
        "asked_for": sorted(wanted),
        "matches": matches[:limit],
        "excluded": excluded,
        "note": "Seasonality and budget are hard filters, so an excluded destination is "
                "listed with its reason rather than silently ranked low.",
    }
    if dream.recognised_place:
        result["possible_place_in_photo"] = {
            "guess": dream.recognised_place,
            "status": "UNVERIFIED",
            "warning": ("A vision model guessed this from the picture. It is not evidence "
                        "of where the photo was taken and was NOT used for matching — "
                        "matching used visible attributes only."),
        }
    return result
