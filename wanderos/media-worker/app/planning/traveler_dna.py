"""Feature 7 — Traveler DNA: a profile that learns across trips.

Every trip starts by asking the same questions. What is your budget, do you like
museums, how much walking is too much — asked again on trip four as if trips one
through three never happened. Meanwhile the answers are sitting in the evidence:
someone who booked three beach trips and skipped every museum has told you what
they like far more reliably than a form ever will.

Three rules that keep this from being creepy or wrong:

**Observed, not inferred about the person.** This records "booked accommodation
in the 80-120/night band on four trips", not "is middle class". Travel
behaviour is the claim; personality is not, and the second is both unfalsifiable
and none of our business.

**Confidence is explicit and grows slowly.** One trip is an anecdote. The
profile reports how many trips back each trait and refuses to act on a single
observation, because a person who took one skiing holiday is not a skier.

**The traveller can overrule any trait, permanently.** A learned preference is a
guess about someone made from their past, and people change — someone who walked
15km a day for years may have a knee injury now. A correction always wins over
observation, and is marked as stated rather than learned so it is never
"re-learned" away by the next trip.

Nothing here is a hidden score used to price or rank anyone. It exists to stop
asking questions we already know the answer to.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from statistics import mean

# Below this many observations a trait is reported but never acted on.
MIN_TRIPS_TO_TRUST = 2
# A trait the traveller stated themselves. Always beats observation.
STATED = "stated"
LEARNED = "learned"


@dataclass
class TripRecord:
    """What one completed trip says about the traveller."""
    trip_id: str
    destination_country: str = ""
    nights: int = 0
    accommodation_type: str = ""       # hostel | hotel | apartment | resort | lodge
    nightly_spend: float | None = None
    activity_tags: list[str] = field(default_factory=list)
    walking_km_per_day: float | None = None
    rest_hours_per_day: float | None = None
    climate: str = ""                  # tropical | temperate | cold | arid
    travelled_with: str = ""           # solo | partner | family | friends
    season: str = ""                   # spring | summer | autumn | winter
    # Things they actively skipped despite them being available. A skip is
    # evidence, and it is the half most systems throw away.
    skipped_tags: list[str] = field(default_factory=list)


@dataclass
class Trait:
    name: str
    value: object
    origin: str = LEARNED
    observations: int = 0
    confidence: float = 0.0
    evidence: str = ""

    @property
    def actionable(self) -> bool:
        return self.origin == STATED or self.observations >= MIN_TRIPS_TO_TRUST

    def as_dict(self) -> dict:
        return {**self.__dict__, "actionable": self.actionable}


def _confidence(observations: int, total: int) -> float:
    """Grows with evidence, and with how consistent that evidence is.

    Capped below 1.0 on purpose: a profile should never claim certainty about a
    person, because the next trip can always contradict it.
    """
    if total == 0:
        return 0.0
    consistency = observations / total
    volume = min(total / 5.0, 1.0)
    return round(min(0.92, consistency * volume), 2)


def build_profile(trips: list[TripRecord],
                  corrections: dict[str, object] | None = None) -> dict:
    """Derive a profile from completed trips, with stated corrections winning."""
    corrections = corrections or {}
    traits: dict[str, Trait] = {}
    total = len(trips)

    if total:
        # Pace, from walking load.
        walks = [t.walking_km_per_day for t in trips if t.walking_km_per_day is not None]
        if walks:
            avg = mean(walks)
            pace = "relaxed" if avg < 4 else "moderate" if avg < 9 else "intense"
            traits["pace"] = Trait("pace", pace, LEARNED, len(walks),
                                   _confidence(len(walks), total),
                                   f"averages {avg:.1f} km/day on foot across {len(walks)} trips")

        # Budget band, from nightly spend.
        spends = [t.nightly_spend for t in trips if t.nightly_spend is not None]
        if spends:
            avg = mean(spends)
            band = ("budget" if avg < 60 else "mid" if avg < 150
                    else "upper-mid" if avg < 300 else "premium")
            traits["budget_band"] = Trait(
                "budget_band", band, LEARNED, len(spends), _confidence(len(spends), total),
                f"averages {avg:.0f}/night across {len(spends)} trips")

        # Accommodation habit.
        stays = Counter(t.accommodation_type for t in trips if t.accommodation_type)
        if stays:
            top, n = stays.most_common(1)[0]
            traits["accommodation"] = Trait("accommodation", top, LEARNED, n,
                                            _confidence(n, total),
                                            f"chose {top} on {n} of {total} trips")

        # Climate preference.
        climates = Counter(t.climate for t in trips if t.climate)
        if climates:
            top, n = climates.most_common(1)[0]
            traits["climate"] = Trait("climate", top, LEARNED, n, _confidence(n, total),
                                      f"chose {top} destinations on {n} of {total} trips")

        # Company.
        company = Counter(t.travelled_with for t in trips if t.travelled_with)
        if company:
            top, n = company.most_common(1)[0]
            traits["travels_as"] = Trait("travels_as", top, LEARNED, n, _confidence(n, total),
                                         f"travelled {top} on {n} of {total} trips")

        # Affinities and aversions. A tag chosen repeatedly is an affinity; one
        # available and repeatedly skipped is an aversion, and knowing what NOT
        # to suggest is as useful as knowing what to.
        liked = Counter(tag for t in trips for tag in t.activity_tags)
        skipped = Counter(tag for t in trips for tag in t.skipped_tags)
        affinities = {tag: _confidence(n, total) for tag, n in liked.items()
                      if n >= MIN_TRIPS_TO_TRUST}
        aversions = {tag: _confidence(n, total) for tag, n in skipped.items()
                     if n >= MIN_TRIPS_TO_TRUST and liked.get(tag, 0) == 0}
        if affinities:
            traits["affinities"] = Trait(
                "affinities", dict(sorted(affinities.items(), key=lambda kv: -kv[1])),
                LEARNED, max(liked.values()), max(affinities.values()),
                f"repeatedly chose: {', '.join(sorted(affinities))}")
        if aversions:
            traits["aversions"] = Trait(
                "aversions", dict(sorted(aversions.items(), key=lambda kv: -kv[1])),
                LEARNED, max(skipped.values()), max(aversions.values()),
                f"available but consistently skipped: {', '.join(sorted(aversions))}")

    # Stated corrections overwrite anything learned, permanently.
    for name, value in corrections.items():
        traits[name] = Trait(name, value, STATED, observations=0, confidence=1.0,
                             evidence="stated by the traveller; overrides observation")

    actionable = {n: t.value for n, t in traits.items() if t.actionable}
    return {
        "trips_analysed": total,
        "traits": {n: t.as_dict() for n, t in traits.items()},
        # Only these should shape a plan. The rest are shown but not used.
        "actionable": actionable,
        "provisional": [n for n, t in traits.items() if not t.actionable],
        "note": (
            f"Traits below {MIN_TRIPS_TO_TRUST} observations are reported but never acted on — "
            "one trip is an anecdote. Any trait can be corrected, and a correction "
            "permanently overrides what was observed."
        ),
    }


def questions_to_skip(profile: dict) -> list[str]:
    """What we already know, so intake stops asking it.

    This is the whole payoff: a returning traveller answers three questions
    instead of fifteen.
    """
    known = profile.get("actionable", {})
    mapping = {
        "pace": "How much walking per day suits you?",
        "budget_band": "What is your nightly accommodation budget?",
        "accommodation": "What kind of place do you like to stay in?",
        "climate": "What climate are you looking for?",
        "travels_as": "Who are you travelling with?",
        "affinities": "What kinds of activities do you enjoy?",
    }
    return [q for trait, q in mapping.items() if trait in known]
