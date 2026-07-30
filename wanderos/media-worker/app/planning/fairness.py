"""Feature 11 — Group Fairness Negotiator.

On a group trip the loudest member decides everything, and the plan that gets
booked is the one nobody objected to loudly enough. The quiet member — usually
the one with a mobility limit or the tightest budget — has a miserable trip that
the group average completely hides.

    Plan A  average 88%   ← the one an optimiser picks
    Plan B  average 84%
            ...but Mother scores 42% on A and 81% on B.

So this does NOT maximise the mean. It maximises the WORST-OFF member's
satisfaction (maximin, in the Rawlsian sense), because the mean is exactly the
statistic that lets one person's ruined trip disappear into four other people's
good one. GroupTravelBench found frontier models weak precisely here.

Two things the mean cannot express and this makes explicit:

**Hard constraints are not preferences.** "I use a wheelchair" and "I like
museums" are different kinds of statement. A hard constraint can never be traded
away for group happiness, no matter how much everyone else gains — a plan that
violates one is infeasible, not merely lower-scoring.

**Sacrifices are named.** When a plan is chosen, every member is told what they
gave up and who gained, because a group decision someone cannot inspect is just
the loud member winning with extra steps.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from statistics import mean


@dataclass
class Member:
    name: str
    # tag -> weight in 0..1. "museums": 0.9 means strongly wanted.
    preferences: dict[str, float] = field(default_factory=dict)
    # Non-negotiable. Violating one makes a plan infeasible, never just worse.
    hard_constraints: set[str] = field(default_factory=set)
    # Optional: this member's ceiling for the whole trip.
    budget_cap: float | None = None


@dataclass
class Plan:
    name: str
    tags: dict[str, float] = field(default_factory=dict)   # tag -> how much the plan delivers, 0..1
    violates: set[str] = field(default_factory=set)        # constraint ids this plan breaks
    cost_per_person: float = 0.0


def satisfaction(member: Member, plan: Plan) -> float:
    """How well a plan serves one member, 0..1.

    Weighted by what the member actually cares about: a plan full of nightlife
    scores near zero for someone who never asked for it, rather than being
    rewarded for delivering something unwanted.
    """
    if not member.preferences:
        return 1.0  # no stated preferences — nothing to disappoint
    total_weight = sum(member.preferences.values()) or 1.0
    got = sum(weight * plan.tags.get(tag, 0.0) for tag, weight in member.preferences.items())
    score = got / total_weight
    if member.budget_cap is not None and plan.cost_per_person > member.budget_cap:
        # Over budget is a real cut, not a rounding issue — scale by how far over.
        overrun = plan.cost_per_person / member.budget_cap
        score /= max(overrun, 1.0)
    return max(0.0, min(1.0, score))


def evaluate(members: list[Member], plan: Plan) -> dict:
    broken = {c for m in members for c in m.hard_constraints} & plan.violates
    scores = {m.name: round(satisfaction(m, plan), 3) for m in members}
    worst_name = min(scores, key=scores.get) if scores else None
    return {
        "plan": plan.name,
        "feasible": not broken,
        "violated_constraints": sorted(broken),
        "blocked_for": sorted(m.name for m in members if m.hard_constraints & plan.violates),
        "satisfaction": scores,
        "average": round(mean(scores.values()), 3) if scores else 0.0,
        # The number that actually decides. Named explicitly so nobody optimises
        # the average by accident.
        "minimum": round(min(scores.values()), 3) if scores else 0.0,
        "worst_off": worst_name,
        "cost_per_person": plan.cost_per_person,
    }


def negotiate(members: list[Member], plans: list[Plan], *,
              min_acceptable: float = 0.5) -> dict:
    """Pick the plan that treats its worst-off member best.

    `min_acceptable` is a floor, not a target: a plan leaving anyone below it is
    reported as failing that member even if it wins on every other measure.
    """
    evaluations = [evaluate(members, p) for p in plans]
    feasible = [e for e in evaluations if e["feasible"]]

    if not feasible:
        return {
            "chosen": None,
            "reason": "every plan violates at least one member's hard constraint",
            "evaluations": evaluations,
            # Say who is blocked and by what — "no plan works" is useless alone.
            "blocking": {e["plan"]: e["blocked_for"] for e in evaluations},
        }

    # Maximin: best worst-case. Average breaks ties only, and never leads.
    chosen = max(feasible, key=lambda e: (e["minimum"], e["average"]))
    best_average = max(feasible, key=lambda e: e["average"])

    sacrifices = []
    if best_average["plan"] != chosen["plan"]:
        for name, score in chosen["satisfaction"].items():
            delta = round(score - best_average["satisfaction"][name], 3)
            if delta < 0:
                sacrifices.append({
                    "member": name, "gave_up": abs(delta),
                    "so_that": best_average["worst_off"],
                    "gains": round(chosen["satisfaction"][best_average["worst_off"]]
                                   - best_average["minimum"], 3),
                })

    below = [n for n, s in chosen["satisfaction"].items() if s < min_acceptable]
    return {
        "chosen": chosen["plan"],
        "reason": (
            f"highest minimum satisfaction ({chosen['minimum']}) — "
            f"'{best_average['plan']}' has a better average ({best_average['average']} vs "
            f"{chosen['average']}) but leaves {best_average['worst_off']} at "
            f"{best_average['minimum']}"
            if best_average["plan"] != chosen["plan"]
            else f"best on both minimum ({chosen['minimum']}) and average ({chosen['average']})"
        ),
        "evaluations": evaluations,
        "sacrifices": sacrifices,
        "still_below_threshold": below,
        "needs_group_decision": bool(below),
    }
