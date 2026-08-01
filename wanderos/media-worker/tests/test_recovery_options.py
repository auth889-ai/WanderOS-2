"""Recovery Theatre — three ways forward that differ from each other."""
from __future__ import annotations

from datetime import datetime

from app.disruption.options import Leg, Option, theatre
from app.journey import twin as T


DEPART = datetime(2026, 6, 1, 10, 30)


def options():
    return [
        Option("High-speed", departs=DEPART, cost=126, legs=[
            Leg("train", 210, step_free="yes"),
            Leg("walk", 8, walking_km=0.6, step_free="yes")]),
        Option("Regional + bus", departs=DEPART, cost=38, legs=[
            Leg("train", 150, step_free="yes"), Leg("bus", 170, step_free="partial"),
            Leg("walk", 15, walking_km=1.2, step_free="unknown")]),
        Option("Fewer changes", departs=DEPART, cost=82, legs=[
            Leg("train", 270, step_free="yes"),
            Leg("walk", 5, walking_km=0.4, step_free="yes")]),
        Option("Coach, stairs only", departs=DEPART, cost=22, legs=[
            Leg("bus", 380, step_free="no"),
            Leg("walk", 20, walking_km=1.8, step_free="no")]),
    ]


def test_the_option_named_cheapest_is_actually_the_cheapest():
    """The bug this test exists for: balanced weights let access and walking
    outvote cost, so 'Cheapest' came back at 82 while 38 sat eligible. A label
    that lies misleads someone choosing under pressure."""
    result = theatre(options(), mobility="moderate")
    cheapest = next(o for o in result["options"] if o["archetype"] == "cheapest")
    eligible_costs = [o.cost for o in options()]
    assert cheapest["cost"] == min(eligible_costs)


def test_the_option_named_fastest_is_actually_the_fastest():
    result = theatre(options(), mobility="moderate")
    fastest = next(o for o in result["options"] if o["archetype"] == "fastest")
    assert fastest["minutes"] == min(o.minutes for o in options())


def test_the_three_options_are_different_journeys():
    """Three variations of 'fastest' is a departure board, not a choice."""
    names = [o["name"] for o in theatre(options())["options"]]
    assert len(set(names)) == len(names)


def test_low_mobility_hard_excludes_a_non_step_free_route():
    result = theatre(options(), mobility="low")
    assert any(e["name"] == "Coach, stairs only" for e in result["excluded"])
    assert all(o["name"] != "Coach, stairs only" for o in result["options"])


def test_the_worst_leg_decides_accessibility():
    """A journey is only as step-free as its hardest change; averaging would
    hide the step that strands someone."""
    mixed = Option("mixed", legs=[Leg("train", 60, step_free="yes"),
                                  Leg("bus", 30, step_free="no")])
    assert mixed.accessibility == "no"


def test_unknown_accessibility_is_never_reported_as_good():
    partly = Option("partly", legs=[Leg("train", 60, step_free="yes"),
                                    Leg("walk", 10, step_free="unknown")])
    assert partly.accessibility == "unknown"
    result = theatre([partly, options()[0]], mobility="moderate")
    flagged = [o for o in result["options"] if o["name"] == "partly"]
    assert all(o["unverified_access"] for o in flagged)


def test_stress_counts_transfers_not_distance():
    """A change of train is not free even when it is quick."""
    one_leg = Option("direct", legs=[Leg("train", 300, walking_km=0.5)])
    three_legs = Option("changes", legs=[Leg("train", 100), Leg("bus", 100),
                                         Leg("train", 100, walking_km=0.5)])
    assert three_legs.stress > one_leg.stress


def test_when_nothing_is_feasible_nothing_is_offered():
    """Presenting an option would imply it is usable."""
    result = theatre([options()[3]], mobility="low")
    assert result["options"] == []
    assert "None is offered" in result["message"]


def test_it_reads_mobility_from_the_twin():
    from app.disruption.options import from_twin

    tw = T.seed("t")
    tw.record(T.MOBILITY, "low", source="traveller")
    result = from_twin(tw, options())
    assert any(e["name"] == "Coach, stairs only" for e in result["excluded"])
