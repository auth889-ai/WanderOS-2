"""Journey Pulse — the board a traveller sees before they ask anything."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.journey import cascade as C
from app.journey import pulse as P
from app.journey import twin as T


def trip(**facts) -> T.Twin:
    tw = T.seed("t1", destination="London", start=date(2026, 8, 4),
                end=date(2026, 8, 11))
    for key, value in facts.items():
        tw.record(key, value, source="third_party", by="test")
    return tw


class TestConnectionGrading:
    def test_graded_against_a_real_requirement_not_a_buffer(self):
        """The same 50 minutes is workable domestically and impossible with
        immigration and baggage re-check. Slack alone cannot tell them apart —
        which is exactly why a raw buffer number misleads."""
        domestic = P.grade_connection(50, P.minimum_connection("domestic", "domestic"))
        international = P.grade_connection(50, P.minimum_connection("international",
                                                                   "international"))
        assert domestic["spare_minutes"] > 0
        assert international["spare_minutes"] < 0
        assert international["grade"] == "risky"

    def test_generous_time_reads_as_relaxed(self):
        relaxed = P.grade_connection(200, P.minimum_connection("domestic", "domestic"))
        assert relaxed["grade"] == "relaxed" and relaxed["band"] == P.GREEN

    def test_a_terminal_change_costs_time(self):
        same = P.minimum_connection("international", "international")
        moved = P.minimum_connection("international", "international",
                                     terminal_change=True)
        assert moved["minutes"] > same["minutes"]

    def test_a_published_mct_beats_our_category_floor(self):
        """The airport knows its own geometry better than any general rule."""
        published = P.minimum_connection("international", "international",
                                         published_mct=45)
        assert published["minutes"] == 45
        assert published["source"] == "published"

    def test_a_guessed_requirement_says_it_is_guessed(self):
        assert P.minimum_connection("international", "domestic")["caveat"]


class TestNodeState:
    def test_protection_outranks_risk(self):
        """'Action needed' is false once the action has been taken."""
        node = P.Node("k", "Hotel", band=P.RED)
        assert node.state == P.RED
        node.protections.append({"action": "late check-in confirmed"})
        assert node.state == P.PURPLE

    def test_purple_requires_a_recorded_action(self):
        """A purple node with no action would be the product claiming credit
        for nothing."""
        assert P.Node("k", "Hotel", band=P.GREEN).state != P.PURPLE

    def test_a_stale_node_admits_it(self):
        past = datetime.now(timezone.utc) - timedelta(hours=1)
        rendered = P.Node("k", "Flight", stale_after=past).as_dict()
        assert rendered["stale"] and rendered["confidence_note"]

    def test_a_fresh_node_carries_no_warning(self):
        future = datetime.now(timezone.utc) + timedelta(hours=1)
        assert not P.Node("k", "Flight", stale_after=future).as_dict()["stale"]


class TestBoard:
    def test_an_empty_trip_invents_no_nodes(self):
        """A ribbon padded with placeholders is a mock-up — the traveller
        cannot tell which parts are real."""
        board = P.build(T.seed("empty"))
        assert board["nodes"] == []
        assert "Nothing is known" in board["headline"]

    def test_a_delayed_flight_turns_the_board_red(self):
        board = P.build(trip(**{T.FLIGHT: {"flight_iata": "BA1", "delay_minutes": 95}}))
        assert board["overall"] == P.RED

    def test_an_on_time_flight_is_green(self):
        board = P.build(trip(**{T.FLIGHT: {"flight_iata": "BA1", "delay_minutes": 0}}))
        assert board["overall"] == P.GREEN

    def test_the_journey_speaks_without_being_asked(self):
        """The traveller should not have to ask whether their trip is intact."""
        board = P.build(trip(**{T.FLIGHT: {"flight_iata": "BA1", "delay_minutes": 0}}))
        assert board["headline"] and "?" not in board["headline"]

    def test_the_worst_node_sets_the_overall_state(self):
        board = P.build(trip(**{
            T.FLIGHT: {"flight_iata": "BA1", "delay_minutes": 95},
            T.WEATHER: {"min_temp_c": 10, "max_temp_c": 15, "rain_expected": True,
                        "kind": "forecast"}}))
        assert board["overall"] == P.RED

    def test_money_owed_appears_on_the_board(self):
        """Compensation is never 'just information'."""
        board = P.build(trip(**{T.ENTITLEMENT: {"eligible": True, "amount": 520,
                                                "currency": "£", "rule": "UK261"}}))
        assert any("520" in n["detail"] for n in board["nodes"])

    def test_the_board_carries_everything_needed_offline(self):
        board = P.build(trip(**{T.FLIGHT: {"flight_iata": "BA1", "delay_minutes": 10}}))
        assert board["offline_ready"]
        import json
        json.dumps(board)   # must serialise whole, for a phone with no network


class TestProtect:
    def test_acting_turns_a_node_purple_and_records_what_was_done(self):
        board = P.build(trip(**{T.FLIGHT: {"flight_iata": "BA1", "delay_minutes": 95}}))
        board = P.protect(board, "flight", action="rebooked onto BA3", by="guardian")
        node = next(n for n in board["nodes"] if n["key"] == "flight")
        assert node["state"] == P.PURPLE
        assert node["protections"][0]["action"] == "rebooked onto BA3"

    def test_the_headline_changes_after_acting(self):
        board = P.build(trip(**{T.FLIGHT: {"flight_iata": "BA1", "delay_minutes": 95}}))
        before = board["headline"]
        board = P.protect(board, "flight", action="rebooked", by="guardian")
        assert board["headline"] != before

    def test_protecting_an_unknown_node_changes_nothing(self):
        board = P.build(trip(**{T.FLIGHT: {"flight_iata": "BA1", "delay_minutes": 95}}))
        assert P.protect(board, "nope", action="x", by="y")["overall"] == P.RED
