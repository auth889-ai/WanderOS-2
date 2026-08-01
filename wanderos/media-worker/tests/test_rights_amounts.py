"""Regulated amounts — the figures that must never be quietly wrong.

A confidently wrong compensation number is worse than no number: someone plans
a claim around it. These tests pin the amounts, the regime differences, and the
requirement that every figure carries its provenance.
"""
from __future__ import annotations

from datetime import datetime

from app.rights import passenger_rights as pr


def test_uk261_amounts_are_gbp_not_relabelled_euros():
    """The bug this file exists for: UK261 was returning the EUR schedule with a
    GBP label, overstating long-haul by GBP 80."""
    assert pr._band_amount(1200, False, "UK261") == 220
    assert pr._band_amount(2500, False, "UK261") == 350
    assert pr._band_amount(5000, False, "UK261") == 520


def test_ec261_amounts_are_unchanged():
    assert pr._band_amount(1200, False, "EC261/2004") == 250
    assert pr._band_amount(2500, False, "EC261/2004") == 400
    assert pr._band_amount(5000, False, "EC261/2004") == 600


def test_the_two_regimes_treat_intra_territory_long_haul_differently():
    """EC261 caps an intra-EU flight at the middle band however long it is;
    UK261 pays the top band on anything over 3,500 km. Collapsing the two is
    what produced the wrong figure."""
    assert pr._band_amount(4000, True, "EC261/2004") == 400
    assert pr._band_amount(4000, True, "UK261") == 520


def test_us_dot_caps_are_the_uprated_figures():
    caps = {cap for _, _, cap in pr.DOT_DENIED_BOARDING["domestic"] if cap}
    assert caps == {1075, 2150}


def test_every_regulated_figure_carries_its_provenance():
    """A stale rule must be visible, not silent."""
    for regime in pr.RULE_SCHEDULES:
        prov = pr.rule_provenance(regime)
        assert prov["effective"] and prov["verified"] and prov["source"]
        assert prov["currency"] in ("EUR", "GBP")


def test_an_assessment_reports_which_schedule_it_used():
    result = pr.assess(pr.Flight(
        "LHR", "JFK", "GB", "US", "GB",
        datetime(2026, 6, 1, 18, 0), datetime(2026, 6, 1, 23, 30),
        departure_latlon=(51.47, -0.4541), arrival_latlon=(40.64, -73.78),
        cause="technical_fault"))
    assert result["rule_provenance"]
    assert result["rule_provenance"][0]["regime"] == "UK261"
    compensation = next(e for e in result["entitlements"] if e["kind"] == "compensation")
    assert compensation["amount"] == 520
    assert compensation["currency"] == "GBP"


def test_dot_schedule_states_it_is_periodically_uprated():
    result = pr.assess(pr.Flight(
        "JFK", "LAX", "US", "US", "US",
        datetime(2026, 6, 1, 12, 0), datetime(2026, 6, 1, 17, 0),
        departure_latlon=(40.64, -73.78), arrival_latlon=(33.94, -118.4),
        disruption="denied_boarding", fare_paid=800))
    assert "eCFR" in result["us_dot_schedule"]["note"]
