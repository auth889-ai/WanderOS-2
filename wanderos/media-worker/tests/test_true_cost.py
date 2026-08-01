"""True cost — the #1 named travel frustration (61%, by a 24-point margin).

The rule that keeps it honest: a confident wrong total is worse than the fare
alone, because it becomes a number someone plans around.
"""
from __future__ import annotations

from app.planning import true_cost as tc


def trip(**kw):
    base = dict(nights=7, travellers=2, headline_price=420, checked_bags=1,
                seat_selection=True, budget_carrier=True, expected_card_spend=900)
    base.update(kw)
    return tc.Trip(**base)


def test_the_headline_price_is_not_the_real_price():
    """The entire point. A search result shows the fare; the account shows this."""
    r = tc.estimate(trip())
    assert r["true_total_typical"] > r["headline_price"] * 1.5
    assert r["percent_above_headline"] > 50


def test_everything_is_a_range_not_a_false_point():
    """A single number invites false precision. The honest answer to 'what will
    the bag cost' is a range plus 'check your carrier'."""
    r = tc.estimate(trip())
    ranged = [l for l in r["lines"] if l["basis"] == tc.TYPICAL]
    assert ranged and all(l["high"] > l["low"] for l in ranged)


def test_a_quoted_price_overrides_the_typical_range():
    """If the traveller was actually shown a number, that number wins."""
    r = tc.estimate(trip(quoted={"checked_bag_each_way": 30.0}))
    bags = next(l for l in r["lines"] if l["label"] == "Checked bags")
    assert bags["basis"] == tc.QUOTED
    assert bags["low"] == bags["high"] == 60.0     # 30 each way


def test_currency_spread_is_surfaced_and_compared():
    """The fee people are least aware of — invisible at the till."""
    r = tc.estimate(trip(expected_card_spend=900, card_type="typical_bank"))
    fx = next(l for l in r["lines"] if l["label"] == "Currency conversion")
    assert fx["mid"] > 25
    assert "fee-free card" in fx["detail"]


def test_a_good_card_costs_less_than_a_bank_card():
    bank = tc.estimate(trip(card_type="typical_bank"))
    good = tc.estimate(trip(card_type="good_card"))
    assert good["extras_typical"] < bank["extras_typical"]


def test_budget_carrier_adds_a_cabin_bag_fee():
    """Budget carriers charging for the overhead bin is the fee that catches
    people who think they packed light enough to avoid fees entirely."""
    with_budget = tc.estimate(trip(budget_carrier=True))
    without = tc.estimate(trip(budget_carrier=False))
    labels = {l["label"] for l in with_budget["lines"]}
    assert "Cabin bag" in labels
    assert with_budget["extras_typical"] > without["extras_typical"]


def test_resort_fee_scales_with_nights():
    short = tc.estimate(trip(nights=2, resort_hotel=True))
    long = tc.estimate(trip(nights=14, resort_hotel=True))
    assert long["extras_typical"] > short["extras_typical"]


def test_biggest_surprises_are_ranked_by_size():
    r = tc.estimate(trip())
    mids = [s["mid"] for s in r["biggest_surprises"]]
    assert mids == sorted(mids, reverse=True)
    assert len(mids) <= 3


def test_unbudgeted_categories_carry_a_number():
    """A warning without a number is easy to dismiss."""
    missing = tc.what_you_forgot(["flights", "accommodation"])
    assert missing
    assert all("typical_low" in m and m["note"] for m in missing)


def test_already_budgeted_categories_are_not_repeated():
    missing = tc.what_you_forgot(["flights", "checked_bag", "seat_selection"])
    keys = {m["category"] for m in missing}
    assert "checked_bag_each_way" not in keys
    assert "seat_selection_each_way" not in keys


def test_disclaimer_states_these_are_not_quotes():
    """Nothing is scraped from a carrier — a stale number presented as fact is
    the problem this exists to fix."""
    r = tc.estimate(trip())
    assert "not quotes" in r["disclaimer"]
    assert "scraped" in r["disclaimer"]
