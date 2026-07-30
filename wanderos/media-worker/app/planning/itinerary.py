"""Feature 10 — Constraint-safe itinerary validation.

The TravelPlanner benchmark (~4M records, 1,225 planning intents) found that
fluent LLM output does not imply constraint satisfaction: models produce plans
that read beautifully and cannot be executed. Closed museums get scheduled,
cross-city hops get twenty minutes, meals vanish, and check-in times are ignored.

So the planner is not trusted to be right — it is checked. Everything here is
deterministic arithmetic over the plan a model produced. No model is consulted,
because "is 20 minutes enough to cross Paris" is a subtraction, not a judgment.

The central rule, and the one LLM itineraries break most often:

    previous_end + travel_time + buffer  <=  next_start

Violations are returned with the arithmetic shown, so the fix is obvious and the
traveller can see WHY something was rejected rather than being told to trust us.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, time, timedelta

from app.common.geo import great_circle_km

# Straight-line km/h by mode. Deliberately pessimistic: great-circle distance
# understates real routing, so an optimistic speed would double-count the error
# and let impossible hops pass.
MODE_SPEED_KMH = {"walk": 4.0, "bike": 12.0, "transit": 18.0, "car": 30.0, "intercity": 70.0}
# Minimum slack between activities. Real trips lose time to queues, toilets and
# finding the entrance; a plan with zero buffer fails on contact with reality.
DEFAULT_BUFFER_MIN = 15
# A day without a meal break in this window is not a plan, it is a forced march.
MEAL_WINDOWS = {"lunch": (time(11, 30), time(15, 0)), "dinner": (time(18, 0), time(22, 0))}
MAX_WALKING_KM_PER_DAY = {"low": 3.0, "moderate": 8.0, "high": 15.0}


@dataclass
class Activity:
    name: str
    start: datetime
    end: datetime
    lat: float | None = None
    lon: float | None = None
    mode_from_previous: str = "transit"
    opening: time | None = None
    closing: time | None = None
    closed_weekdays: set[int] = field(default_factory=set)  # 0 = Monday
    requires_ticket: bool = False
    ticket_booked: bool = False
    cost: float = 0.0
    step_free: bool | None = None
    outdoor: bool = False

    def duration_min(self) -> float:
        return (self.end - self.start).total_seconds() / 60


@dataclass
class Violation:
    rule: str
    severity: str          # blocking | warning
    activity: str
    detail: str
    suggestion: str = ""

    def as_dict(self) -> dict:
        return dict(self.__dict__)


def travel_minutes(a: Activity, b: Activity) -> float | None:
    """Real routed travel time between two activities.

    Uses the actual street network rather than straight-line distance, which
    understates city hops by around 30% — and underestimating travel is exactly
    how an itinerary becomes unexecutable.
    """
    if None in (a.lat, a.lon, b.lat, b.lon):
        return None
    from app.planning.routing import leg

    return leg(a.lat, a.lon, b.lat, b.lon, mode=b.mode_from_previous).minutes


def travel_leg(a: Activity, b: Activity):
    """The full routed leg, including where each number came from."""
    if None in (a.lat, a.lon, b.lat, b.lon):
        return None
    from app.planning.routing import leg

    return leg(a.lat, a.lon, b.lat, b.lon, mode=b.mode_from_previous)


def validate_day(
    activities: list[Activity],
    *,
    buffer_min: int = DEFAULT_BUFFER_MIN,
    mobility: str = "moderate",
    daily_budget: float | None = None,
    require_meals: bool = True,
) -> dict:
    """Check one day's plan. Returns violations with the arithmetic shown."""
    ordered = sorted(activities, key=lambda a: a.start)
    violations: list[Violation] = []

    for i, act in enumerate(ordered):
        if act.end <= act.start:
            violations.append(Violation(
                "duration", "blocking", act.name,
                f"ends at {act.end:%H:%M}, at or before its {act.start:%H:%M} start"))

        # Opening hours — the classic "scheduled a closed museum".
        if act.closed_weekdays and act.start.weekday() in act.closed_weekdays:
            violations.append(Violation(
                "closed_that_day", "blocking", act.name,
                f"closed on {act.start:%A}s",
                "move to another day or drop it"))
        if act.opening and act.start.time() < act.opening:
            violations.append(Violation(
                "opens_later", "blocking", act.name,
                f"scheduled {act.start:%H:%M} but opens {act.opening:%H:%M}",
                f"start no earlier than {act.opening:%H:%M}"))
        if act.closing and act.end.time() > act.closing:
            violations.append(Violation(
                "closes_earlier", "blocking", act.name,
                f"runs to {act.end:%H:%M} but closes {act.closing:%H:%M}",
                f"end by {act.closing:%H:%M}"))

        if act.requires_ticket and not act.ticket_booked:
            violations.append(Violation(
                "ticket_missing", "warning", act.name,
                "needs a ticket that is not booked",
                "book ahead or expect to be turned away"))

        if mobility == "low" and act.step_free is False:
            violations.append(Violation(
                "not_step_free", "blocking", act.name,
                "not step-free, and this trip is planned for low mobility",
                "find a step-free alternative"))

        # The no-teleportation rule.
        if i > 0:
            prev = ordered[i - 1]
            routed = travel_leg(prev, act)
            minutes = routed.minutes if routed else None
            gap = (act.start - prev.end).total_seconds() / 60
            if minutes is not None:
                needed = minutes + buffer_min
                if gap < needed:
                    source = ("real street routing" if routed.distance_source == "osrm"
                              else "estimated distance (router unreachable)")
                    violations.append(Violation(
                        "no_teleportation", "blocking", act.name,
                        f"{gap:.0f} min after '{prev.name}' ends, but the hop is "
                        f"{routed.distance_km:.2f} km by {act.mode_from_previous} "
                        f"[{source}] needing ~{minutes:.0f} min "
                        f"+ {buffer_min} min buffer = {needed:.0f} min",
                        f"start at {(prev.end + timedelta(minutes=needed)):%H:%M} or later"))
            elif gap < buffer_min:
                violations.append(Violation(
                    "no_buffer", "warning", act.name,
                    f"only {gap:.0f} min after '{prev.name}'; no coordinates to check the hop",
                    f"leave at least {buffer_min} min"))

    # Meals. Checked as "is there a gap long enough to eat", not "is there an
    # activity called lunch" — eating during a long gap is fine.
    if require_meals and ordered:
        for meal, (from_t, to_t) in MEAL_WINDOWS.items():
            day = ordered[0].start.date()
            window_start = datetime.combine(day, from_t)
            window_end = datetime.combine(day, to_t)
            if ordered[-1].end < window_start or ordered[0].start > window_end:
                continue  # the day does not span this meal
            free = _longest_free_gap(ordered, window_start, window_end)
            if free < 40:
                violations.append(Violation(
                    "no_meal_break", "warning", meal,
                    f"longest free gap in the {meal} window is {free:.0f} min",
                    "leave at least 40 minutes to eat"))

    # Walking load.
    walked = 0.0
    for i in range(1, len(ordered)):
        if ordered[i].mode_from_previous == "walk":
            a, b = ordered[i - 1], ordered[i]
            routed = travel_leg(a, b)
            if routed is not None:
                walked += routed.distance_km
    cap = MAX_WALKING_KM_PER_DAY.get(mobility, 8.0)
    if walked > cap:
        violations.append(Violation(
            "walking_load", "warning", "day",
            f"~{walked:.1f} km on foot against a {cap:.0f} km limit for '{mobility}' mobility",
            "swap a leg to transit"))

    spend = sum(a.cost for a in ordered)
    if daily_budget is not None and spend > daily_budget:
        violations.append(Violation(
            "over_budget", "warning", "day",
            f"{spend:.2f} planned against a {daily_budget:.2f} budget",
            "drop or swap the most expensive activity"))

    blocking = [v for v in violations if v.severity == "blocking"]
    return {
        "feasible": not blocking,
        "activities": len(ordered),
        "violations": [v.as_dict() for v in violations],
        "blocking_count": len(blocking),
        "warning_count": len(violations) - len(blocking),
        "walking_km": round(walked, 2),
        "planned_spend": round(spend, 2),
    }


def _longest_free_gap(ordered: list[Activity], start: datetime, end: datetime) -> float:
    """Longest unscheduled stretch inside [start, end], in minutes."""
    cursor, longest = start, 0.0
    for act in ordered:
        if act.end <= start or act.start >= end:
            continue
        longest = max(longest, (min(act.start, end) - cursor).total_seconds() / 60)
        cursor = max(cursor, min(act.end, end))
    return max(longest, (end - cursor).total_seconds() / 60)
