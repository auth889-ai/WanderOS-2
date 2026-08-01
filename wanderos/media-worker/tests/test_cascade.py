"""Cascade — what breaks next, and what does not."""
from __future__ import annotations

from datetime import datetime

import pytest

from app.journey.cascade import Commitment, Graph, propagate, _risk


def chain(**kw) -> Graph:
    return (Graph()
            .add(Commitment("a", "Flight", "flight", starts=datetime(2026, 8, 4, 21, 0)))
            .add(Commitment("b", "Connection", "connection",
                            starts=datetime(2026, 8, 4, 22, 30), **kw))
            .depends("b", on="a", slack_minutes=90, transfer_minutes=30))


class TestSlackDecides:
    def test_a_delay_inside_the_slack_breaks_nothing(self):
        """The common case. Reporting it as a risk is how a product becomes
        noise the traveller mutes."""
        result = propagate(chain(), origin="a", delay_minutes=20)
        assert result["at_risk"] == []
        assert result["absorbed"], "containment must be reported, not silent"
        assert result["worst_band"] == "green"

    def test_a_delay_beyond_the_slack_breaks_the_next_thing(self):
        result = propagate(chain(), origin="a", delay_minutes=120)
        assert result["at_risk"][0]["risk"] > 0.9

    def test_transfer_time_is_not_slack(self):
        """30 minutes of walking a terminal is not 30 minutes of buffer."""
        graph = chain()
        graph.dependencies[0].transfer_minutes = 0
        loose = propagate(graph, origin="a", delay_minutes=70)["at_risk"]
        tight = propagate(chain(), origin="a", delay_minutes=70)["at_risk"]
        assert not loose or loose[0]["risk"] < tight[0]["risk"]

    def test_only_the_overrun_travels_downstream(self):
        """A 100-minute delay against 60 minutes of slack arrives as 40 late,
        not 100. Passing the whole delay on would compound into fiction."""
        result = propagate(chain(), origin="a", delay_minutes=100)
        assert result["at_risk"][0]["late_by_minutes"] == pytest.approx(40, abs=1)


class TestRiskModel:
    def test_a_certain_delay_is_a_certainty_not_a_risk(self):
        """With no uncertainty a known delay past the slack is 100%."""
        assert _risk(80, 60, 0) == 1.0
        assert _risk(40, 60, 0) == 0.0

    def test_risk_rises_with_the_delay(self):
        assert _risk(30, 60, 15) < _risk(60, 60, 15) < _risk(90, 60, 15)

    def test_at_the_slack_boundary_it_is_a_coin_flip(self):
        assert _risk(60, 60, 15) == pytest.approx(0.5, abs=0.01)


class TestMoney:
    def test_a_refundable_booking_is_not_money_lost(self):
        result = propagate(chain(value=300, refundable=True),
                           origin="a", delay_minutes=200)
        assert result["expected_loss"] == 0

    def test_unknown_value_is_never_counted_as_zero(self):
        """A confident total assembled from guesses is worse than an honest
        partial one."""
        result = propagate(chain(value=None, refundable=False),
                           origin="a", delay_minutes=200)
        assert result["expected_loss"] == 0
        assert "Connection" in result["unpriced_at_risk"]

    def test_loss_is_weighted_by_probability(self):
        low = propagate(chain(value=100, refundable=False), origin="a",
                        delay_minutes=95)["expected_loss"]
        high = propagate(chain(value=100, refundable=False), origin="a",
                         delay_minutes=200)["expected_loss"]
        assert low < high <= 100


class TestHardDeadlines:
    def test_a_closing_reception_is_detected_with_the_overshoot(self):
        graph = (Graph()
                 .add(Commitment("a", "Flight", starts=datetime(2026, 8, 4, 21, 0)))
                 .add(Commitment("b", "Hotel check-in", "stay",
                                 starts=datetime(2026, 8, 4, 23, 0),
                                 hard_deadline=datetime(2026, 8, 4, 23, 30)))
                 .depends("b", on="a", slack_minutes=30))
        result = propagate(graph, origin="a", delay_minutes=180)
        assert result["at_risk"][0]["hard_deadline_breached"]


class TestGraphSafety:
    def test_an_unknown_origin_is_reported_not_guessed(self):
        assert "error" in propagate(chain(), origin="nope", delay_minutes=60)

    def test_a_cycle_terminates(self):
        """Bookings can reference each other. The walk must still end."""
        graph = chain()
        graph.depends("a", on="b", slack_minutes=10)
        result = propagate(graph, origin="a", delay_minutes=300)
        assert "at_risk" in result

    def test_headline_is_one_actionable_sentence(self):
        head = propagate(chain(value=200, refundable=False),
                         origin="a", delay_minutes=150)["headline"]
        assert head.count(".") <= 4 and "risk" in head
