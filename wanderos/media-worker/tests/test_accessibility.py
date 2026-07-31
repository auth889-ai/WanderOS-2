"""Accessibility Reality Layer — the rule is that unknown is never yes.

Travellers with access needs report the same failure everywhere: apps repeat a
venue's marketing as fact. The cost of that error is a person stranded outside a
building they planned a day around, so these tests pin the grading rules rather
than the data.
"""
from __future__ import annotations

import pytest

from app.planning import accessibility as a


def _fact(subject, value, source, **kw):
    return a.AccessFact(subject=subject, attribute="step_free", value=value,
                        source=source, **kw)


class TestSourceGrading:
    def test_someone_who_was_there_outranks_the_venues_own_claim(self):
        """The incumbent failure is repeating marketing as fact."""
        merged = a.merge_facts([
            _fact("Hotel X", "step_free", a.SELF_DECLARED),
            _fact("Hotel X", "not_accessible", a.TRAVELLER, detail="three steps"),
        ])
        assert len(merged) == 1
        assert merged[0].value == "not_accessible"
        assert merged[0].source == a.TRAVELLER

    def test_official_data_outranks_everything(self):
        merged = a.merge_facts([
            _fact("Station", "step_free", a.TRAVELLER),
            _fact("Station", "not_accessible", a.OFFICIAL),
        ])
        assert merged[0].source == a.OFFICIAL

    def test_a_self_declared_claim_is_not_trustworthy_on_its_own(self):
        assert not _fact("Venue", "step_free", a.SELF_DECLARED).trustworthy
        assert _fact("Venue", "step_free", a.CROWDSOURCED).trustworthy


class TestNeverGuess:
    def test_unmapped_place_answers_unknown_not_yes(self):
        """An app that guesses 'probably accessible' is worse than one that says
        nothing — you cannot plan around a wrong answer."""
        result = a.assess_place("Nowhere", [], need="step_free")
        assert result["answer"] == "unknown"
        assert result["safe_to_assume"] is False
        assert "call ahead" in result["advice"].lower()

    def test_limited_is_never_promoted_to_yes(self):
        """'limited' usually means a step, a narrow door, or staff assistance."""
        result = a.assess_place("Cafe", [_fact("Cafe", "partial", a.CROWDSOURCED)])
        assert result["answer"] == "partial"
        assert result["safe_to_assume"] is False

    def test_only_a_trustworthy_yes_is_safe_to_assume(self):
        weak = a.assess_place("Cafe", [_fact("Cafe", "step_free", a.SELF_DECLARED)])
        strong = a.assess_place("Cafe", [_fact("Cafe", "step_free", a.CROWDSOURCED)])
        assert weak["safe_to_assume"] is False
        assert strong["safe_to_assume"] is True

    def test_not_accessible_is_reported_plainly(self):
        result = a.assess_place("Metro", [_fact("Metro", "not_accessible", a.CROWDSOURCED)])
        assert result["answer"] == "no"


class TestSensoryBudget:
    def test_a_short_airport_day_can_beat_a_long_walk(self):
        """Distance is the wrong measure. Transfers and crowding are what
        exhaust people, and no mainstream planner counts them."""
        airport = a.sensory_budget(
            a.DayPlan(activities=["airport", "metro", "shopping_centre"],
                      walking_km=2, transfers=4), tolerance="low")
        walk = a.sensory_budget(
            a.DayPlan(activities=["park", "hike"], walking_km=9, quiet_breaks=1),
            tolerance="low")
        assert airport["load"] > walk["load"]
        assert not airport["within_budget"]
        assert walk["within_budget"]

    def test_quiet_breaks_reduce_load(self):
        without = a.sensory_budget(a.DayPlan(activities=["market", "museum"]))
        with_break = a.sensory_budget(
            a.DayPlan(activities=["market", "museum"], quiet_breaks=2))
        assert with_break["load"] < without["load"]

    def test_transfers_are_counted_even_with_no_walking(self):
        flat = a.sensory_budget(a.DayPlan(activities=[], walking_km=0, transfers=5))
        assert flat["load"] > 0, "a day of transitions is not a free day"

    def test_suggestions_name_the_heaviest_item(self):
        result = a.sensory_budget(
            a.DayPlan(activities=["festival", "park"], transfers=3), tolerance="low")
        assert result["heaviest"][0] == "festival"
        assert result["suggestions"]

    def test_tolerance_changes_the_budget_not_the_load(self):
        day = a.DayPlan(activities=["museum", "market"], transfers=2)
        low = a.sensory_budget(day, tolerance="low")
        high = a.sensory_budget(day, tolerance="high")
        assert low["load"] == high["load"]
        assert low["budget"] < high["budget"]


class TestAccessCard:
    def test_card_is_designed_to_be_shown_not_spoken(self):
        """Explaining your needs to a stranger in a loud airport under stress is
        the hard part — not having the needs."""
        card = a.access_card(needs=["step-free", "quiet space"])
        assert card["show_dont_say"] is True
        assert card["works_offline"] is True
        assert any("quiet" in p.lower() for p in card["phrases"])


@pytest.mark.network
def test_real_osm_data_is_reachable():
    facts = a.nearby_access(48.8606, 2.3376, radius_m=600, limit=10)
    assert facts, "expected OSM wheelchair tags near the Louvre"
    assert all(f.source == a.CROWDSOURCED for f in facts)
