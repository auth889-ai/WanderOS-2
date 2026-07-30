"""Planning invariants — the arithmetic that must not drift.

Each test here pins a rule that was either wrong once or would be invisible if
it broke. Dates measured from the wrong end, an average hiding one ruined trip,
a rebalancer proposing to cancel money already spent: none of these raise, they
just quietly produce a worse answer.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta

from app.planning import budget as bud
from app.planning import fairness, futures, itinerary, packing, readiness, traveler_dna


class TestItineraryConstraints:
    D = datetime(2026, 6, 2)  # a Tuesday

    def _at(self, h, m):
        return self.D.replace(hour=h, minute=m)

    def test_closed_weekday_blocks(self):
        day = [itinerary.Activity("Louvre", self._at(9, 0), self._at(11, 0),
                                  closed_weekdays={1})]
        result = itinerary.validate_day(day, require_meals=False)
        assert not result["feasible"]
        assert any(v["rule"] == "closed_that_day" for v in result["violations"])

    def test_activity_ending_before_it_starts_is_blocking(self):
        day = [itinerary.Activity("Broken", self._at(14, 0), self._at(13, 0))]
        result = itinerary.validate_day(day, require_meals=False)
        assert any(v["rule"] == "duration" for v in result["violations"])

    def test_opening_hours_are_enforced_both_ends(self):
        day = [itinerary.Activity("Museum", self._at(7, 0), self._at(20, 0),
                                  opening=time(9, 0), closing=time(18, 0))]
        rules = {v["rule"] for v in itinerary.validate_day(day, require_meals=False)["violations"]}
        assert "opens_later" in rules and "closes_earlier" in rules

    def test_low_mobility_blocks_non_step_free(self):
        day = [itinerary.Activity("Tower", self._at(10, 0), self._at(11, 0), step_free=False)]
        result = itinerary.validate_day(day, mobility="low", require_meals=False)
        assert any(v["rule"] == "not_step_free" and v["severity"] == "blocking"
                   for v in result["violations"])

    def test_missing_coordinates_warn_rather_than_silently_pass(self):
        """No coordinates means the hop CANNOT be checked. Saying nothing would
        let an impossible plan through looking validated."""
        day = [itinerary.Activity("A", self._at(9, 0), self._at(10, 0)),
               itinerary.Activity("B", self._at(10, 5), self._at(11, 0))]
        result = itinerary.validate_day(day, require_meals=False)
        assert any(v["rule"] == "no_buffer" for v in result["violations"])

    def test_over_budget_is_reported(self):
        day = [itinerary.Activity("Pricey", self._at(10, 0), self._at(11, 0), cost=200)]
        result = itinerary.validate_day(day, daily_budget=50, require_meals=False)
        assert any(v["rule"] == "over_budget" for v in result["violations"])

    def test_a_clean_day_is_feasible(self):
        """The suite must be able to say yes, or it is just an alarm."""
        day = [itinerary.Activity("Breakfast", self._at(9, 0), self._at(10, 0)),
               itinerary.Activity("Walk", self._at(16, 0), self._at(17, 0))]
        assert itinerary.validate_day(day, require_meals=False)["feasible"]


class TestGroupFairness:
    def _members(self):
        return [
            fairness.Member("Quiet", {"rest": 1.0}, hard_constraints={"step_free"}),
            fairness.Member("Loud", {"nightlife": 1.0}),
            fairness.Member("Third", {"nightlife": 0.8, "food": 0.5}),
        ]

    def test_hard_constraint_makes_a_plan_infeasible_not_merely_worse(self):
        """A wheelchair requirement is not a preference to be outvoted."""
        plans = [fairness.Plan("Stairs", {"nightlife": 1.0, "food": 1.0, "rest": 1.0},
                               violates={"step_free"})]
        result = fairness.negotiate(self._members(), plans)
        assert result["chosen"] is None
        assert "Quiet" in result["blocking"]["Stairs"]

    def test_maximin_beats_a_better_average(self):
        """The whole point: an average lets one ruined trip vanish inside three
        good ones."""
        members = self._members()
        high_average = fairness.Plan("Party", {"nightlife": 1.0, "food": 1.0, "rest": 0.05})
        balanced = fairness.Plan("Balanced", {"nightlife": 0.6, "food": 0.6, "rest": 0.7})
        result = fairness.negotiate(members, [high_average, balanced])

        by_name = {e["plan"]: e for e in result["evaluations"]}
        assert by_name["Party"]["average"] > by_name["Balanced"]["average"], \
            "fixture must actually pit average against minimum"
        assert result["chosen"] == "Balanced"

    def test_sacrifices_name_who_gave_up_what(self):
        result = fairness.negotiate(
            self._members(),
            [fairness.Plan("Party", {"nightlife": 1.0, "food": 1.0, "rest": 0.05}),
             fairness.Plan("Balanced", {"nightlife": 0.6, "food": 0.6, "rest": 0.7})])
        assert result["sacrifices"], "a group decision nobody can inspect is not a decision"
        assert all("member" in s and "gave_up" in s for s in result["sacrifices"])

    def test_member_below_threshold_is_flagged_for_a_human_decision(self):
        result = fairness.negotiate(
            self._members(),
            [fairness.Plan("Thin", {"nightlife": 0.4, "food": 0.2, "rest": 0.1})],
            min_acceptable=0.5)
        assert result["needs_group_decision"]
        assert "Quiet" in result["still_below_threshold"]


class TestReadiness:
    TODAY = date(2026, 7, 31)

    def test_six_month_rule_is_measured_from_the_RETURN_date(self):
        """The near-universal trap is checking against departure. A passport can
        clear the outbound date and still strand you on the way home.

        The expiry below is chosen to sit BETWEEN the two answers:
            departure 2026-09-20 + 180d = 2027-03-19  -> would pass
            return    2026-10-02 + 180d = 2027-03-31  -> must fail

        An earlier version of this test used an expiry that failed either way,
        so it passed even when the code measured from departure. Mutation
        testing caught that it was blind; this fixture makes it discriminate.
        """
        passport = readiness.Document("passport", holder_name="A B",
                                      expires=date(2027, 3, 25))
        result = readiness.check_readiness(
            [passport], departure=date(2026, 9, 20), return_date=date(2026, 10, 2),
            today=self.TODAY)
        assert not result["ready"], "expiry clears departure+6mo but not return+6mo"
        assert any(f["code"] == "passport_six_month_rule" for f in result["findings"])

    def test_a_comfortably_valid_passport_passes(self):
        passport = readiness.Document("passport", holder_name="A B",
                                      expires=date(2030, 1, 1))
        booking = readiness.Document("booking", holder_name="A B")
        insurance = readiness.Document("insurance", expires=date(2026, 12, 31))
        result = readiness.check_readiness(
            [passport, booking, insurance], departure=date(2026, 9, 20),
            return_date=date(2026, 10, 2), today=self.TODAY)
        assert result["ready"], result["findings"]

    def test_missing_middle_name_is_not_a_mismatch(self):
        """Flagging every difference trains people to ignore the one that matters."""
        mismatched, _ = readiness.name_mismatch("JANNATUL FERDOUSE EVA", "Jannatul Ferdouse")
        assert not mismatched

    def test_different_surname_is_a_mismatch(self):
        mismatched, _ = readiness.name_mismatch("JANNATUL FERDOUSE", "Eva Rahman")
        assert mismatched

    def test_entry_requirements_are_never_decided_here(self):
        """The module must refuse to answer a legal question, and say so."""
        result = readiness.check_readiness(
            [readiness.Document("passport", expires=date(2030, 1, 1))],
            departure=date(2026, 9, 20), destination_country="Italy", today=self.TODAY)
        visa = next(f for f in result["findings"] if f["code"] == "entry_requirements")
        assert visa["severity"] == "check"
        assert visa["human_review_required"]
        assert visa["jurisdiction"] == "Italy"


class TestPacking:
    def test_lithium_and_medication_are_forced_to_the_cabin(self):
        """A safety rule, not a preference — and it must override any earlier
        assignment, so it is applied last."""
        result = packing.build_packing_list(packing.TripProfile(
            days=5, medications=["insulin"], activities=["business"]))
        cabin = {i["name"] for i in result["cabin"]}
        assert "medication" in cabin
        assert "laptop" in cabin
        assert all(r["bag"] == "cabin" for r in result["safety_rules"]
                   if r["item"] in ("medication", "laptop", "passport"))

    def test_adapter_only_appears_when_plug_types_differ(self):
        same = packing.build_packing_list(packing.TripProfile(
            days=3, home_country="GB", destination_country="IE"))
        differs = packing.build_packing_list(packing.TripProfile(
            days=3, home_country="GB", destination_country="FR"))
        names = lambda r: {i["name"] for group in ("cabin", "checked", "either")
                           for i in r[group]}
        assert "travel_adapter" not in names(same), "GB and IE share type G"
        assert "travel_adapter" in names(differs)

    def test_unknown_destination_asks_rather_than_guesses(self):
        """A wrong adapter is the same as no adapter."""
        result = packing.build_packing_list(packing.TripProfile(
            days=3, home_country="GB", destination_country="ZZ"))
        adapter = [i for group in ("cabin", "checked", "either")
                   for i in result[group] if i["name"] == "travel_adapter"]
        assert adapter and "unknown" in adapter[0]["because"]

    def test_shared_items_count_once_per_group(self):
        one = packing.build_packing_list(packing.TripProfile(
            days=5, travellers=1, rain_expected=True, min_temp_c=15))
        four = packing.build_packing_list(packing.TripProfile(
            days=5, travellers=4, rain_expected=True, min_temp_c=15))
        assert "umbrella" in one["shared_items"]
        # Four travellers must not mean four umbrellas' worth of weight.
        assert four["estimated_checked_kg"] < one["estimated_checked_kg"] * 4

    def test_cold_forecast_adds_warm_layers(self):
        cold = packing.build_packing_list(packing.TripProfile(days=5, min_temp_c=-5))
        names = {i["name"] for group in ("cabin", "checked", "either") for i in cold[group]}
        assert {"jacket", "thermal_layer", "gloves"} <= names


class TestBudget:
    def _budget(self):
        return bud.Budget(total=1000, expenses=[
            bud.Expense("Flight", "flights", 400, bud.State.COMMITTED),
            bud.Expense("Hotel", "accommodation", 300, bud.State.REFUNDABLE,
                        swappable_to=200),
            bud.Expense("Tour", "activities", 150, bud.State.PLANNED, day=3,
                        swappable_to=60),
        ])

    def test_rebalance_never_proposes_cancelling_committed_money(self):
        """Cancelling a paid flight frees nothing. Proposing it is the classic
        naive-optimiser failure."""
        result = bud.rebalance(self._budget(), target=150)
        assert all(a["item"] != "Flight" for a in result["actions"])
        assert result["untouchable"] == 400

    def test_swaps_are_preferred_to_drops(self):
        """A traveller told to cancel the thing they came for ignores the tool."""
        result = bud.rebalance(self._budget(), target=150)
        assert result["achievable"]
        assert all(a["action"] == "swap" for a in result["actions"])

    def test_headline_is_changeable_money_not_naive_remainder(self):
        state = bud.status(self._budget())
        assert state["still_changeable"] == 450   # hotel + tour only
        assert state["committed"] == 400

    def test_reserve_is_held_back_from_available(self):
        state = bud.status(self._budget())
        assert state["reserve_held_back"] == 100
        assert state["available"] == 1000 - 100 - 850

    def test_unbudgeted_categories_are_named(self):
        assert "baggage_fees" in bud.status(self._budget())["unbudgeted_categories"]

    def test_disruption_flags_non_refundable_spend_on_that_day(self):
        budget = self._budget()
        budget.expenses.append(
            bud.Expense("Day tour", "activities", 90, bud.State.COMMITTED, day=3))
        flagged = bud.flag_at_risk(budget, disrupted_days={3})
        assert [f["item"] for f in flagged] == ["Day tour"]


class TestFutures:
    def _futures(self):
        return [
            futures.Future("Cheap", 500, 10.0, 6, 5.0, False, 0.9, 0.1, 8),
            futures.Future("Balanced", 1000, 5.0, 3, 8.0, True, 0.5, 0.7, 5),
        ]

    def test_accessibility_is_a_hard_gate_not_a_score_penalty(self):
        result = futures.compare(self._futures(), mobility="low")
        assert result["recommendations"]["cheapest"]["future"] == "Balanced", \
            "the cheaper plan is not step-free and must be excluded, not merely ranked lower"

    def test_confidence_falls_as_assumptions_rise(self):
        certain = futures.Future("Booked", 900, 5, 2, 8, True, 0.4, 0.8, 5)
        guessed = futures.Future("Guessed", 900, 5, 2, 8, True, 0.4, 0.8, 5,
                                 assumptions=["a", "b", "c", "d"])
        assert certain.confidence() > guessed.confidence()

    def test_every_future_is_labelled_as_a_simulation(self):
        """A render of a hotel nobody has seen must never read as a photograph."""
        for row in futures.compare(self._futures())["futures"]:
            assert row["preview_label"] == futures.SYNTHETIC_PREVIEW
            assert "not a photograph" in row["preview_disclaimer"]


class TestTravelerDna:
    def _trips(self):
        return [traveler_dna.TripRecord(f"t{i}", accommodation_type="hostel",
                                        nightly_spend=40, activity_tags=["beach"],
                                        skipped_tags=["museums"], climate="tropical")
                for i in range(4)]

    def test_single_observation_is_reported_but_not_acted_on(self):
        """One skiing holiday does not make a skier."""
        profile = traveler_dna.build_profile([
            traveler_dna.TripRecord("t1", accommodation_type="lodge", climate="cold")])
        assert "accommodation" in profile["traits"]
        assert "accommodation" in profile["provisional"]
        assert "accommodation" not in profile["actionable"]

    def test_repeated_skips_become_an_aversion(self):
        """Knowing what NOT to suggest is the half most systems discard."""
        profile = traveler_dna.build_profile(self._trips())
        assert "museums" in profile["traits"]["aversions"]["value"]

    def test_a_correction_permanently_overrides_observation(self):
        profile = traveler_dna.build_profile(self._trips(),
                                             corrections={"accommodation": "hotel"})
        trait = profile["traits"]["accommodation"]
        assert trait["value"] == "hotel"
        assert trait["origin"] == traveler_dna.STATED
        assert trait["actionable"]

    def test_confidence_never_claims_certainty(self):
        for trait in traveler_dna.build_profile(self._trips())["traits"].values():
            if trait["origin"] == traveler_dna.LEARNED:
                assert trait["confidence"] < 1.0
