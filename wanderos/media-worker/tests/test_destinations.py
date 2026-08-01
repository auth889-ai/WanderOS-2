"""Real destinations — attributes counted from the map, not assigned by me."""
from __future__ import annotations

from app.planning import destinations as dest


class TestAttributeDerivation:
    def test_a_sparse_count_is_not_an_attribute(self):
        """One museum does not make a museum town; below the floor it is noise."""
        attrs = dest._attributes_from({"museums": 1, "food": 40}, None)
        assert "museums" not in attrs
        assert "food" in attrs

    def test_scaling_is_logarithmic(self):
        """Linear scaling lets one dense city dominate every comparison. What
        matters is whether a place HAS a characteristic, not that it has 400."""
        few = dest._attributes_from({"food": 10}, None)["food"]
        many = dest._attributes_from({"food": 500}, None)["food"]
        assert few < many
        assert many / few < 3, "500 must not score 50x what 10 does"

    def test_every_attribute_is_bounded(self):
        attrs = dest._attributes_from({k: 9999 for k in dest.POI_QUERIES}, 1)
        assert all(0.0 <= v <= 1.0 for v in attrs.values())

    def test_population_becomes_a_crowding_proxy(self):
        village = dest._attributes_from({}, 2_000)["low_crowds"]
        metropolis = dest._attributes_from({}, 12_000_000)["low_crowds"]
        assert village > metropolis

    def test_no_map_data_asserts_nothing(self):
        """No beach nodes means 'we do not know', not 'no beaches'. Returning
        zeros would read as absence."""
        assert dest._attributes_from({}, None) == {}


class TestComparison:
    def test_unresolvable_places_are_reported(self):
        result = dest.compare([], {"food": 1.0})
        assert result["matches"] == []

    def test_no_criteria_returns_no_matches(self):
        assert dest.compare(["Ubud"], {})["matches"] == []


class TestDestinationShape:
    def test_an_unresolved_destination_knows_it(self):
        d = dest.Destination(name="Nowhere")
        assert not d.resolved
        assert d.as_dict()["resolved"] is False

    def test_sources_are_recorded_per_field(self):
        """A field without a source is a field nobody can check."""
        d = dest.Destination(name="X", lat=1.0, lon=2.0,
                             sources={"location": "Open-Meteo geocoding (CC-BY)"})
        assert "location" in d.sources


import pytest


@pytest.mark.network
def test_resolves_a_place_that_was_never_in_the_catalogue():
    d = dest.enrich("Chefchaouen", with_summary=False)
    assert d and d.resolved
    assert d.country_code == "MA"


@pytest.mark.network
def test_counts_real_pois():
    d = dest.enrich("Reykjavik", with_summary=False)
    assert d and sum(d.poi_counts.values()) > 0
