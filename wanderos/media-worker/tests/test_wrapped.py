"""Year in Travel — the differentiator is that every number states its basis.

A Wrapped card is the most-shared artifact in consumer apps and every travel
version has the same flaw: the numbers are unverifiable. These tests pin the
behaviour that makes ours different — it must never quietly round up.
"""
from __future__ import annotations

from app.delivery import wrapped as w


def _trip(**kw):
    base = dict(trip_id="t", title="Trip", countries=["ID"], places=["Ubud"],
                km=100, days=5, photos=100, photos_with_gps=100, photos_with_date=100)
    base.update(kw)
    return w.TripSummary(**base)


def test_full_evidence_is_marked_verified():
    card = w.build([_trip()], year=2026)
    countries = next(s for s in card["stats"] if s["key"] == "countries")
    assert countries["basis"] == w.VERIFIED


def test_partial_location_data_downgrades_to_estimated():
    """The honest case: most photo libraries are not fully geotagged."""
    card = w.build([_trip(photos=100, photos_with_gps=40)], year=2026)
    distance = next(s for s in card["stats"] if s["key"] == "distance_km")
    assert distance["basis"] == w.ESTIMATED
    assert "40 of 100" in distance["detail"]


def test_no_location_data_reports_unknown_rather_than_zero():
    """Reporting 0 km would be a lie. Reporting 'unknown' is the feature."""
    card = w.build([_trip(photos=100, photos_with_gps=0, km=0)], year=2026)
    distance = next(s for s in card["stats"] if s["key"] == "distance_km")
    assert distance["basis"] == w.UNKNOWN
    assert distance["value"] is None


def test_corrections_are_surfaced_not_hidden():
    """A number the traveller fixed should say so — it is stronger, not weaker."""
    card = w.build([_trip(corrections=3)], year=2026)
    places = next(s for s in card["stats"] if s["key"] == "places")
    assert places["basis"] == w.CORRECTED
    assert card["corrections_included"] == 3


def test_evidence_gap_is_a_first_class_stat():
    """The admission is displayed, not buried in a footnote."""
    card = w.build([_trip(photos=100, photos_with_gps=70)], year=2026)
    assert any(s["key"] == "evidence_gap" for s in card["stats"])


def test_no_evidence_gap_stat_when_everything_is_evidenced():
    card = w.build([_trip(photos=100, photos_with_gps=100)], year=2026)
    assert not any(s["key"] == "evidence_gap" for s in card["stats"])


def test_repeat_visits_become_a_superlative():
    card = w.build([_trip(places=["Tokyo", "Kyoto", "Tokyo"])], year=2026)
    top = next(s for s in card["stats"] if s["key"] == "most_returned")
    assert "Tokyo" in str(top["value"])


def test_card_hash_detects_an_edited_card():
    """A shared image must be checkable against the record that produced it."""
    card = w.build([_trip()], year=2026)
    assert w.verify_card(card)["verified"]

    tampered = dict(card)
    tampered["stats"] = card["stats"][:-1]
    assert not w.verify_card(tampered)["verified"]


def test_empty_year_says_so_rather_than_rendering_zeros():
    card = w.build([], year=2026)
    assert card["empty"] and card["stats"] == []


def test_every_stat_carries_a_human_readable_basis():
    for stat in w.build([_trip(photos=100, photos_with_gps=55)], year=2026)["stats"]:
        assert stat["basis"] in (w.VERIFIED, w.CORRECTED, w.ESTIMATED, w.UNKNOWN)
        assert stat["basis_label"]
