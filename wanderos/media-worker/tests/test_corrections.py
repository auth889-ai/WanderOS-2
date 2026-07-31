"""Correction ledger — the traveller's authority over their own timeline.

The invariant that matters most: a correction must never silently erase the
record that the system once claimed otherwise. A product that rewrites history
to look right is exactly as untrustworthy as one that gets it wrong.
"""
from __future__ import annotations

import pytest

from app.evidence import corrections as fix


def journey():
    return {"stops": [
        {"id": "s1", "place": "Ubud", "photos": ["a", "b", "c"]},
        {"id": "s2", "place": "Frankfurt International Airport", "photos": ["d"]},
        {"id": "s3", "place": "Seminyak", "photos": ["e", "f"]},
        {"id": "s4", "place": "Seminyak", "photos": ["g"]},
    ], "route": [0, 1, 2, 3], "stats": {"places_visited": 4}}


def test_phantom_stop_can_be_removed():
    """The complaint this exists for: a layover you cannot delete."""
    result = fix.apply_corrections(journey(), [
        fix.Correction(fix.REMOVE_STOP, "s2", reason="layover")])
    places = [s["place"] for s in result["journey"]["stops"]]
    assert "Frankfurt International Airport" not in places
    assert result["applied"][0]["kind"] == fix.REMOVE_STOP


def test_removal_does_not_erase_the_original_claim():
    """Auditability. Silently rewriting history is the failure mode."""
    result = fix.apply_corrections(journey(), [
        fix.Correction(fix.REMOVE_STOP, "s2", reason="layover")])
    assert result["original_stop_count"] == 4
    assert result["applied"][0]["removed"]["place"] == "Frankfurt International Airport"
    assert len(result["audit"]) == 1


def test_route_indices_stay_valid_after_a_removal():
    """An off-by-one here silently reorders someone's trip."""
    result = fix.apply_corrections(journey(), [
        fix.Correction(fix.REMOVE_STOP, "s2", reason="layover")])
    route, stops = result["journey"]["route"], result["journey"]["stops"]
    assert sorted(route) == list(range(len(stops)))


def test_a_stop_can_be_targeted_by_place_name_or_id():
    """Travellers think in place names; the UI passes ids. A correction rejected
    for using the human name is one the traveller believes they made."""
    by_name = fix.apply_corrections(journey(), [
        fix.Correction(fix.REMOVE_STOP, "Frankfurt International Airport")])
    by_id = fix.apply_corrections(journey(), [fix.Correction(fix.REMOVE_STOP, "s2")])
    assert len(by_name["journey"]["stops"]) == len(by_id["journey"]["stops"]) == 3


def test_duplicate_stops_merge_and_keep_all_photos():
    result = fix.apply_corrections(journey(), [
        fix.Correction(fix.MERGE_STOPS, "s3+s4", reason="same_place")])
    seminyak = [s for s in result["journey"]["stops"] if s["place"] == "Seminyak"]
    assert len(seminyak) == 1
    assert len(seminyak[0]["photos"]) == 3, "merging must not lose photos"


def test_traveller_may_assert_a_place_with_no_photo():
    """The inverse of the consent gate: the system may not invent a moment, but
    the person who was there may."""
    result = fix.apply_corrections(journey(), [
        fix.Correction(fix.ADD_STOP, "new",
                       replacement={"place": "Nusa Penida", "lat": -8.7, "lon": 115.5})])
    added = [s for s in result["journey"]["stops"] if s["place"] == "Nusa Penida"]
    assert added and added[0]["evidence"] == "traveller_asserted"


def test_corrections_become_user_confirmed_evidence():
    claims = fix.as_claims([fix.Correction(fix.REMOVE_STOP, "s2", reason="layover")])
    assert claims[0]["status"] == "USER_CONFIRMED"
    assert claims[0]["confidence"] == 1.0
    assert "never" in claims[0]["text"].lower()


def test_unknown_correction_kind_is_rejected_loudly():
    with pytest.raises(ValueError):
        fix.Correction("delete_everything", "s1")


def test_impossible_correction_is_reported_not_silently_dropped():
    result = fix.apply_corrections(journey(), [
        fix.Correction(fix.REMOVE_STOP, "does-not-exist")])
    assert result["applied"] == []
    assert len(result["rejected"]) == 1


def test_reorder_must_account_for_every_stop():
    """A partial reorder would drop stops from the map without saying so."""
    result = fix.apply_corrections(journey(), [
        fix.Correction(fix.REORDER, "route", replacement={"route": [0, 1]})])
    assert result["rejected"], "an incomplete route must be refused"


def test_layover_artefacts_are_suggested_unprompted():
    """A correction feature nobody finds is not a feature."""
    prompts = fix.suggest_corrections(journey())
    airport = [p for p in prompts if "Frankfurt" in str(p["place"])]
    assert airport and airport[0]["suggested"] == fix.REMOVE_STOP
    assert airport[0]["reason_hint"] == "layover"


def test_duplicate_places_are_suggested_for_merge():
    prompts = fix.suggest_corrections(journey())
    assert any(p["suggested"] == fix.MERGE_STOPS for p in prompts)


def test_input_journey_is_never_mutated():
    original = journey()
    fix.apply_corrections(original, [fix.Correction(fix.REMOVE_STOP, "s2")])
    assert len(original["stops"]) == 4, "the original inference must survive"
