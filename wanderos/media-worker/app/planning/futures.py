"""Feature 9 — Trip Digital Twin and Compare Futures.

Before booking, nobody can see which plan will actually be tiring, which one
quietly costs more, or which one collapses when it rains. They compare two
itineraries that both read well and pick on vibes.

So each candidate is scored on the axes people actually regret afterwards —
cost, fatigue, transfers, rest, accessibility, weather exposure, and what
happens when something is cancelled — and the trade-offs are stated rather than
collapsed into one number. A single "best" score would hide exactly the
information the decision needs.

**The constraint that matters here, from the feature spec:** a generated
preview of a future must never be shown as evidence of a real hotel, flight or
weather outcome. These are simulations of a PLAN, not depictions of a place.
Anything rendered from one is labelled `SYNTHETIC_PREVIEW` and is barred from
the evidence path — the same discipline the film's consent gate applies, for the
same reason. A beautiful render of a hotel nobody has seen is an advertisement
you accidentally made for yourself.

Confidence is reported per future and falls as more of the plan is assumed
rather than known, because a precise-looking score built on guesses is worse
than an admittedly rough one.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# The archetypes from the spec. Each is a weighting, not a separate algorithm.
ARCHETYPES = {
    "cheapest": {"cost": 1.0, "fatigue": 0.1, "rest": 0.1, "accessibility": 0.1,
                 "weather_risk": 0.1, "cancellation_risk": 0.2, "memorability": 0.2},
    "most_comfortable": {"cost": 0.2, "fatigue": 1.0, "rest": 1.0, "accessibility": 0.5,
                         "weather_risk": 0.4, "cancellation_risk": 0.3, "memorability": 0.4},
    "most_accessible": {"cost": 0.2, "fatigue": 0.7, "rest": 0.6, "accessibility": 1.0,
                        "weather_risk": 0.3, "cancellation_risk": 0.3, "memorability": 0.3},
    "lowest_risk": {"cost": 0.3, "fatigue": 0.3, "rest": 0.4, "accessibility": 0.3,
                    "weather_risk": 1.0, "cancellation_risk": 1.0, "memorability": 0.2},
    "most_memorable": {"cost": 0.2, "fatigue": 0.2, "rest": 0.2, "accessibility": 0.2,
                       "weather_risk": 0.3, "cancellation_risk": 0.3, "memorability": 1.0},
}

SYNTHETIC_PREVIEW = "SYNTHETIC_PREVIEW"


@dataclass
class Future:
    name: str
    cost: float
    walking_km_per_day: float
    transfers: int
    rest_hours_per_day: float
    step_free: bool
    outdoor_fraction: float          # 0..1 — how exposed the plan is to weather
    refundable_fraction: float       # 0..1 — how much can be recovered if cancelled
    unique_experiences: int
    assumptions: list[str] = field(default_factory=list)   # what is guessed, not known

    def confidence(self) -> float:
        """Falls as more of the plan rests on assumptions.

        Reported rather than hidden: a score of 0.83 built on five guesses should
        not look like one built on a confirmed booking.
        """
        return round(max(0.35, 1.0 - 0.12 * len(self.assumptions)), 2)


def _normalise(values: list[float], *, lower_is_better: bool) -> list[float]:
    """Scale to 0..1 across the candidates. Comparison is relative because
    'is 6km of walking a lot' only means anything against the alternatives."""
    lo, hi = min(values), max(values)
    if hi == lo:
        return [1.0] * len(values)
    scaled = [(v - lo) / (hi - lo) for v in values]
    return [1.0 - s for s in scaled] if lower_is_better else scaled


def compare(futures: list[Future], *, budget: float | None = None,
            mobility: str = "moderate") -> dict:
    if not futures:
        return {"futures": [], "recommendations": {}}

    axes = {
        "cost": _normalise([f.cost for f in futures], lower_is_better=True),
        "fatigue": _normalise([f.walking_km_per_day for f in futures], lower_is_better=True),
        "transfers": _normalise([float(f.transfers) for f in futures], lower_is_better=True),
        "rest": _normalise([f.rest_hours_per_day for f in futures], lower_is_better=False),
        "weather_risk": _normalise([f.outdoor_fraction for f in futures], lower_is_better=True),
        "cancellation_risk": _normalise([f.refundable_fraction for f in futures],
                                        lower_is_better=False),
        "memorability": _normalise([float(f.unique_experiences) for f in futures],
                                   lower_is_better=False),
    }

    scored = []
    for i, f in enumerate(futures):
        detail = {k: round(v[i], 3) for k, v in axes.items()}
        detail["accessibility"] = 1.0 if f.step_free else 0.0
        row = {
            "name": f.name,
            "cost": f.cost,
            "scores": detail,
            "confidence": f.confidence(),
            "assumptions": f.assumptions,
            "over_budget": bool(budget is not None and f.cost > budget),
            # Hard gate, not a score penalty. Low mobility plus no step-free
            # access is infeasible, exactly as in the fairness negotiator.
            "infeasible_for_mobility": mobility == "low" and not f.step_free,
            "preview_label": SYNTHETIC_PREVIEW,
            "preview_disclaimer": (
                "Any visual preview of this future is a simulation of the PLAN. It is not "
                "a photograph of the hotel, flight or weather and must never be shown as "
                "evidence that any of them looked this way."
            ),
        }
        scored.append(row)

    def best_for(archetype: str) -> dict | None:
        weights = ARCHETYPES[archetype]
        eligible = [r for r in scored if not r["infeasible_for_mobility"]]
        if budget is not None and archetype != "most_memorable":
            within = [r for r in eligible if not r["over_budget"]]
            eligible = within or eligible
        if not eligible:
            return None
        def weighted(r: dict) -> float:
            return sum(w * r["scores"].get(axis, 0.0) for axis, w in weights.items())
        winner = max(eligible, key=weighted)
        return {"future": winner["name"], "weighted_score": round(weighted(winner), 3),
                "confidence": winner["confidence"]}

    recommendations = {a: best_for(a) for a in ARCHETYPES}

    # Trade-offs stated explicitly — the point of the feature is that no single
    # number should decide this.
    tradeoffs = []
    cheapest = min(scored, key=lambda r: r["cost"])
    comfiest = max(scored, key=lambda r: r["scores"]["rest"] + r["scores"]["fatigue"])
    if cheapest["name"] != comfiest["name"]:
        tradeoffs.append(
            f"'{cheapest['name']}' saves {comfiest['cost'] - cheapest['cost']:.0f} "
            f"but is the more tiring plan; '{comfiest['name']}' buys rest with money")
    blocked = [r["name"] for r in scored if r["infeasible_for_mobility"]]
    if blocked:
        tradeoffs.append(f"not step-free, so unavailable at this mobility level: {', '.join(blocked)}")

    return {
        "futures": scored,
        "recommendations": recommendations,
        "tradeoffs": tradeoffs,
        "note": ("Scores are relative across these candidates only, and confidence falls "
                 "as more of a plan is assumed rather than booked."),
    }
