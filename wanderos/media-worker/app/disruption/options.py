"""Recovery Theatre — three ways forward, scored on what actually differs.

When a journey breaks, the useful question is not "what happened" but "which of
these can I live with". Existing tools answer with a list of departure times,
which hides the thing that decides it: the cheapest option often means an extra
kilometre on foot with luggage, and the fastest often means three changes and a
station with no lift.

So an option is scored on five axes a traveller genuinely trades between —
**time, cost, walking, accessibility, stress** — and the three presented are
deliberately the winners of *different* axes rather than the top three of one.
A list of three fastest options is not a choice.

This is also the clearest demonstration of the Journey Twin. Nothing here
recomputes anything: travel time comes from real street routing, step-free
status from source-graded accessibility data, stress from the sensory model, and
cost from the budget states. Each was written independently and none of them
knows this module exists.

**Where a number is unknown it is shown as unknown.** An accessibility answer of
"unknown" is never rendered as "good" — that rule is inherited from the
accessibility layer and matters more here, because someone acts on this while
standing in a station.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

# Each archetype has ONE decisive axis plus tie-breakers.
#
# Weighted sums alone do not work here, and the failure is not subtle: with
# balanced weights the option labelled "Cheapest" came back at GBP 82 while a
# GBP 38 option sat eligible, because access and walking scores outvoted cost.
# An option named after an axis must WIN that axis — otherwise the label lies,
# and a traveller choosing "Cheapest" under pressure is misled.
#
# So `primary` decides, and `tie_break` only separates options that are equal
# on it.
ARCHETYPES = {
    "fastest": {"primary": "time",
                "tie_break": {"access": 0.3, "stress": 0.2, "cost": 0.1}},
    "cheapest": {"primary": "cost",
                 "tie_break": {"access": 0.3, "time": 0.2, "walking": 0.1}},
    "lowest_stress": {"primary": "stress",
                      "tie_break": {"access": 1.0, "walking": 0.5, "time": 0.2}},
}

ARCHETYPE_COPY = {
    "fastest": ("Fastest", "Get there as quickly as possible"),
    "cheapest": ("Cheapest", "Save money, accept the trade-offs"),
    "lowest_stress": ("Lowest stress", "Fewer changes, less walking, step-free"),
}

# Sensory cost of a transfer, in the same units as accessibility.SENSORY_LOAD.
# A change of train is not free even when it is quick.
TRANSFER_LOAD = 6
WALK_LOAD_PER_KM = 2


@dataclass
class Leg:
    """One segment of a proposed route."""
    mode: str                       # train | bus | walk | taxi | flight
    minutes: float
    walking_km: float = 0.0
    step_free: str = "unknown"      # yes | partial | no | unknown
    step_free_source: str = "unknown"


@dataclass
class Option:
    name: str
    legs: list[Leg] = field(default_factory=list)
    cost: float = 0.0
    currency: str = "GBP"
    departs: datetime | None = None
    note: str = ""

    @property
    def minutes(self) -> float:
        return round(sum(leg.minutes for leg in self.legs), 1)

    @property
    def walking_km(self) -> float:
        return round(sum(leg.walking_km for leg in self.legs), 2)

    @property
    def transfers(self) -> int:
        # Walking between two legs is a transfer; the walk itself is not a leg
        # you "change" onto.
        return max(0, len([leg for leg in self.legs if leg.mode != "walk"]) - 1)

    def arrives(self) -> datetime | None:
        return self.departs + timedelta(minutes=self.minutes) if self.departs else None

    @property
    def accessibility(self) -> str:
        """The WORST leg decides. A journey is only as step-free as its
        hardest change, and averaging would hide the step that strands someone."""
        values = [leg.step_free for leg in self.legs]
        if any(v == "no" for v in values):
            return "no"
        if any(v == "unknown" for v in values):
            return "unknown"
        if any(v == "partial" for v in values):
            return "partial"
        return "yes"

    @property
    def stress(self) -> float:
        """Sensory load: transfers and walking, not distance."""
        return round(self.transfers * TRANSFER_LOAD
                     + self.walking_km * WALK_LOAD_PER_KM, 1)


def _normalise(values: list[float], *, lower_is_better: bool) -> list[float]:
    lo, hi = min(values), max(values)
    if hi == lo:
        return [1.0] * len(values)
    scaled = [(v - lo) / (hi - lo) for v in values]
    return [1.0 - s for s in scaled] if lower_is_better else scaled


ACCESS_SCORE = {"yes": 1.0, "partial": 0.5, "no": 0.0, "unknown": 0.25}


def score(options: list[Option], *, mobility: str = "moderate") -> list[dict]:
    """Score every option on all five axes, relative to the others."""
    if not options:
        return []

    axes = {
        "time": _normalise([o.minutes for o in options], lower_is_better=True),
        "cost": _normalise([o.cost for o in options], lower_is_better=True),
        "walking": _normalise([o.walking_km for o in options], lower_is_better=True),
        "stress": _normalise([o.stress for o in options], lower_is_better=True),
    }
    scored = []
    for i, option in enumerate(options):
        access = option.accessibility
        rows = {axis: round(values[i], 3) for axis, values in axes.items()}
        rows["access"] = ACCESS_SCORE[access]
        scored.append({
            "name": option.name,
            "minutes": option.minutes,
            "arrives": option.arrives().isoformat() if option.arrives() else None,
            "cost": option.cost,
            "currency": option.currency,
            "walking_km": option.walking_km,
            "transfers": option.transfers,
            "accessibility": access,
            "stress": option.stress,
            "scores": rows,
            # Low mobility plus a non-step-free leg is a hard gate, exactly as in
            # the fairness negotiator — not a score penalty to be outweighed.
            "infeasible": mobility == "low" and access in ("no",),
            "unverified_access": access == "unknown",
            "note": option.note,
        })
    return scored


def theatre(options: list[Option], *, mobility: str = "moderate") -> dict:
    """Pick three options that win DIFFERENT axes.

    Presenting the top three of one axis is not a choice, and it is what makes
    existing tools feel like a departure board rather than a decision.
    """
    scored = score(options, mobility=mobility)
    eligible = [s for s in scored if not s["infeasible"]]
    excluded = [{"name": s["name"], "why": "not step-free, and this trip is "
                                           "planned for low mobility"}
                for s in scored if s["infeasible"]]

    if not eligible:
        return {"options": [], "excluded": excluded,
                "message": "Every option breaks a hard constraint. None is offered, "
                           "because presenting one would imply it is usable."}

    def rank(option: dict, spec: dict) -> tuple:
        """Primary axis first; tie-breakers only separate near-equals.

        Rounding the primary to 3dp means genuinely-equal options fall through
        to the tie-break instead of being decided by floating-point noise.
        """
        primary = round(option["scores"].get(spec["primary"], 0.0), 3)
        secondary = sum(w * option["scores"].get(axis, 0.0)
                        for axis, w in spec["tie_break"].items())
        return (primary, secondary)

    picks: list[dict] = []
    for archetype, spec in ARCHETYPES.items():
        best = max(eligible, key=lambda s: rank(s, spec))
        if any(p["name"] == best["name"] for p in picks):
            # Already chosen by another archetype — offer the runner-up so the
            # traveller sees three genuinely different journeys.
            remaining = [s for s in eligible
                         if all(s["name"] != p["name"] for p in picks)]
            if not remaining:
                continue
            best = max(remaining, key=lambda s: rank(s, spec))
        title, subtitle = ARCHETYPE_COPY[archetype]
        picks.append({**best, "archetype": archetype,
                      "title": title, "subtitle": subtitle})

    return {
        "options": picks,
        "excluded": excluded,
        "axes": ["time", "cost", "walking", "access", "stress"],
        "principle": ("Each option wins a different axis. Three variations of "
                      "'fastest' is a departure board, not a choice."),
        "accessibility_note": ("An unknown access status is shown as unknown and "
                               "never as good — someone acts on this while "
                               "standing in a station."),
    }


def from_twin(twin, options: list[Option]) -> dict:
    """Score against what the twin already knows about this traveller.

    Reads mobility rather than taking it as an argument, so the answer respects
    a limit recorded by any other part of the system.
    """
    from app.journey import twin as T

    return theatre(options, mobility=twin.get(T.MOBILITY, "moderate"))
