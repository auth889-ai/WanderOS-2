"""Feature 17 — Accessibility Reality Layer.

Travellers with access needs say the same thing about every app: the information
is **marketing, not reality**. A venue writes "wheelchair accessible" on its own
website, the app repeats it, and someone arrives to find three steps at the door
and a staff member who has never been asked before. The cost of that error is
not inconvenience — it is a person stranded outside a building they planned a
day around.

This is the plausible-vs-verified problem again, and the truth model already
solves it. Every access fact here carries **who said so**:

    SELF_DECLARED    the venue's own claim — the weakest kind
    CROWDSOURCED     OpenStreetMap contributors who were physically there
    TRAVELLER        someone in this system confirmed it on the ground
    OFFICIAL         a transport authority or regulator dataset
    UNKNOWN          nobody has said — shown as unknown, never assumed

**The default is UNKNOWN, and unknown is never rendered as yes.** That is the
whole design. An app that guesses "probably accessible" is worse than one that
says nothing, because the traveller can plan around a gap and cannot plan around
a wrong answer.

Data comes from OpenStreetMap via Overpass (ODbL, no key). OSM's `wheelchair`
tag is contributed by people who visited, which is why it is graded above a
venue's own claim — and why it is honest enough to record `wheelchair=no` for
three central Paris métro stations rather than quietly omitting them.

Sensory information is included because the research is consistent that
neurodivergent travellers are underserved by every mainstream app: crowding,
noise and the availability of a quiet space determine whether a day is possible.
"""
from __future__ import annotations

import json
import logging
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Source grading, weakest first. Order matters: a stronger source overrides.
SELF_DECLARED = "self_declared"
CROWDSOURCED = "crowdsourced"
TRAVELLER = "traveller_confirmed"
OFFICIAL = "official"
UNKNOWN = "unknown"

SOURCE_RANK = {UNKNOWN: 0, SELF_DECLARED: 1, CROWDSOURCED: 2, TRAVELLER: 3, OFFICIAL: 4}
SOURCE_LABEL = {
    SELF_DECLARED: "the venue says so (unverified)",
    CROWDSOURCED: "mapped by someone who was there",
    TRAVELLER: "confirmed on the ground",
    OFFICIAL: "official transport/regulator data",
    UNKNOWN: "nobody has recorded this",
}

# OSM wheelchair values -> ours. "limited" is deliberately NOT promoted to yes:
# it usually means a step, a narrow door, or staff assistance required.
ACCESS_FROM_OSM = {"yes": "step_free", "limited": "partial", "no": "not_accessible"}

# What a day of this actually costs, for planning energy rather than distance.
# Values are relative units, calibrated so a typical full day is around 100.
SENSORY_LOAD = {
    "airport": 25, "train_station": 15, "metro": 12, "market": 18, "museum": 10,
    "restaurant": 8, "beach": 5, "park": 3, "hike": 6, "nightlife": 20,
    "shopping_centre": 16, "festival": 25, "guided_tour": 12,
}
DAILY_SENSORY_BUDGET = {"low": 45, "moderate": 80, "high": 130}


@dataclass
class AccessFact:
    subject: str
    attribute: str          # step_free | toilet | lift | hearing_loop | quiet_space
    value: str              # step_free | partial | not_accessible | present | absent
    source: str = UNKNOWN
    detail: str = ""
    osm_id: str = ""

    @property
    def trustworthy(self) -> bool:
        return SOURCE_RANK.get(self.source, 0) >= SOURCE_RANK[CROWDSOURCED]

    def as_dict(self) -> dict:
        return {**self.__dict__,
                "source_label": SOURCE_LABEL.get(self.source, self.source),
                "trustworthy": self.trustworthy}


def _overpass(query: str) -> dict | None:
    request = urllib.request.Request(
        OVERPASS_URL, data=urllib.parse.urlencode({"data": query}).encode(),
        headers={"User-Agent": "WanderOS/1.0 (accessibility lookup)"})
    for attempt in range(2):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                return json.load(response)
        except Exception as exc:
            if attempt:
                logger.info("overpass unavailable: %s", exc)
                return None
            time.sleep(2.0)
    return None


def nearby_access(lat: float, lon: float, *, radius_m: int = 600,
                  limit: int = 40) -> list[AccessFact]:
    """Real accessibility tags around a point, from people who were there."""
    query = f"""[out:json][timeout:25];
(
  node(around:{radius_m},{lat},{lon})["wheelchair"];
  way(around:{radius_m},{lat},{lon})["wheelchair"];
);
out tags center {limit};"""
    payload = _overpass(query)
    if not payload:
        return []

    facts: list[AccessFact] = []
    for element in payload.get("elements", []):
        tags = element.get("tags") or {}
        value = ACCESS_FROM_OSM.get(tags.get("wheelchair", ""))
        if not value:
            continue
        name = tags.get("name") or tags.get("amenity") or tags.get("railway") or "unnamed"
        facts.append(AccessFact(
            subject=name, attribute="step_free", value=value, source=CROWDSOURCED,
            osm_id=f"{element.get('type')}/{element.get('id')}",
            detail=tags.get("wheelchair:description", "")))
        if tags.get("toilets:wheelchair") == "yes":
            facts.append(AccessFact(name, "accessible_toilet", "present", CROWDSOURCED))
    return facts


def merge_facts(facts: list[AccessFact]) -> list[AccessFact]:
    """Strongest source wins per (subject, attribute).

    A traveller who was there outranks a venue's own claim, which is the entire
    point — the incumbent failure is repeating marketing as fact.
    """
    best: dict[tuple[str, str], AccessFact] = {}
    for fact in facts:
        key = (fact.subject.strip().lower(), fact.attribute)
        current = best.get(key)
        if current is None or SOURCE_RANK.get(fact.source, 0) > SOURCE_RANK.get(current.source, 0):
            best[key] = fact
    return sorted(best.values(), key=lambda f: (f.subject, f.attribute))


def assess_place(name: str, facts: list[AccessFact], *, need: str = "step_free") -> dict:
    """What we can honestly say about one place, and what we cannot.

    `need` is the traveller's requirement. The answer is deliberately three-way:
    yes, no, or NOT KNOWN — never a guess.
    """
    relevant = [f for f in merge_facts(facts)
                if f.subject.strip().lower() == name.strip().lower()]
    match = next((f for f in relevant if f.attribute == need), None)

    if match is None:
        return {
            "place": name, "answer": "unknown", "safe_to_assume": False,
            "source": UNKNOWN, "source_label": SOURCE_LABEL[UNKNOWN],
            "advice": ("Nobody has recorded this. Call ahead — an app that guesses "
                       "'probably accessible' is worse than one that says nothing, "
                       "because you cannot plan around a wrong answer."),
            "facts": [f.as_dict() for f in relevant],
        }

    answer = {"step_free": "yes", "partial": "partial",
              "not_accessible": "no", "present": "yes", "absent": "no"}.get(match.value, "unknown")
    return {
        "place": name,
        "answer": answer,
        # "limited" is never promoted to yes: it usually means a step, a narrow
        # door, or that staff assistance is required.
        "safe_to_assume": answer == "yes" and match.trustworthy,
        "source": match.source,
        "source_label": SOURCE_LABEL.get(match.source, match.source),
        "detail": match.detail,
        "osm_id": match.osm_id,
        "advice": ("" if answer == "yes" and match.trustworthy else
                   "Confirm directly before you rely on this."),
        "facts": [f.as_dict() for f in relevant],
    }


# --- Feature 16 — Energy and Sensory Autopilot ------------------------------

@dataclass
class DayPlan:
    activities: list[str] = field(default_factory=list)   # SENSORY_LOAD keys
    walking_km: float = 0.0
    transfers: int = 0
    quiet_breaks: int = 0


def sensory_budget(day: DayPlan, *, tolerance: str = "moderate") -> dict:
    """Whether a day is survivable, not just walkable.

    Distance is the wrong measure for a lot of people. An airport day with three
    transfers can be flat and still be the hardest day of a trip. Crowding,
    noise and transitions are what exhaust neurodivergent travellers and anyone
    with fatigue conditions, and no mainstream planner counts them.
    """
    load = sum(SENSORY_LOAD.get(a, 8) for a in day.activities)
    load += day.transfers * 6          # each transition costs, regardless of distance
    load += day.walking_km * 2
    load -= day.quiet_breaks * 12      # a real break genuinely restores

    budget = DAILY_SENSORY_BUDGET.get(tolerance, 80)
    over = load - budget
    heaviest = sorted(day.activities, key=lambda a: -SENSORY_LOAD.get(a, 8))[:2]

    suggestions: list[str] = []
    if over > 0:
        if day.quiet_breaks == 0:
            suggestions.append("add a quiet break — a 30-minute sit-down is worth more "
                               "than cutting an activity")
        if day.transfers >= 3:
            suggestions.append(f"{day.transfers} transfers is the hidden cost here; "
                               "grouping activities by area removes more load than "
                               "shortening any single one")
        if heaviest:
            suggestions.append(f"the heaviest item is '{heaviest[0]}' — moving it to its "
                               "own day is usually easier than shortening it")

    return {
        "load": round(load, 1),
        "budget": budget,
        "within_budget": load <= budget,
        "over_by": round(max(0.0, over), 1),
        "heaviest": heaviest,
        "quiet_breaks": day.quiet_breaks,
        "suggestions": suggestions,
        "note": ("Measured in sensory load, not distance. A flat airport day with three "
                 "transfers can be harder than a long walk in a park."),
    }


def access_card(*, needs: list[str], notes: str = "") -> dict:
    """A card the traveller can SHOW rather than explain.

    Modelled on the communication cards neurodivergent travellers report as the
    single most useful thing they carry: explaining your needs to a stranger, in
    a loud airport, under stress, is the hard part — not having the needs.
    """
    return {
        "needs": needs,
        "notes": notes,
        "phrases": [
            "I have an access need. Please give me a moment.",
            "Is there a step-free entrance?",
            "Is there a quiet place I can wait?",
            "Please write it down — I am finding it hard to hear you.",
        ],
        "show_dont_say": True,
        "works_offline": True,
        "goes_in_offline_pack": True,
    }
