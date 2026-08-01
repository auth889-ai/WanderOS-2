"""The Journey Twin — the spine that stops features being islands.

An audit found 14 of 30 modules with zero callers: the packing list never saw
the weather already fetched, the rescue engine never saw the mobility limits.
These tests pin the rules that prevent that recurring.
"""
from __future__ import annotations

from datetime import date

import pytest

from app.journey import enrich
from app.journey import twin as T


def test_a_stronger_source_replaces_a_weaker_one():
    tw = T.Twin("t")
    tw.record(T.MOBILITY, "moderate", source="inferred", by="guess")
    assert tw.record(T.MOBILITY, "low", source="traveller", by="intake")
    assert tw.get(T.MOBILITY) == "low"


def test_a_weaker_source_cannot_overwrite_a_stronger_one():
    """Without this, whichever module ran last would win — and a venue's
    marketing claim could silently overwrite a traveller's correction."""
    tw = T.Twin("t")
    tw.record(T.MOBILITY, "low", source="traveller", by="intake")
    assert tw.record(T.MOBILITY, "high", source="inferred", by="guess") is False
    assert tw.get(T.MOBILITY) == "low"


def test_a_rejected_write_is_recorded_not_discarded():
    """A wrong answer must be traceable."""
    tw = T.Twin("t")
    tw.record(T.MOBILITY, "low", source="traveller")
    tw.record(T.MOBILITY, "high", source="inferred")
    assert tw.superseded
    assert tw.superseded[-1]["rejected"]["value"] == "high"
    assert "outranks" in tw.superseded[-1]["why"]


def test_a_replaced_value_stays_visible():
    tw = T.Twin("t")
    tw.record(T.COUNTRY, "XX", source="inferred")
    tw.record(T.COUNTRY, "ID", source="official")
    assert tw.get(T.COUNTRY) == "ID"
    assert any(e.get("replaced", {}).get("value") == "XX" for e in tw.superseded)


def test_an_unknown_source_is_rejected_loudly():
    with pytest.raises(ValueError):
        T.Fact("x", source="vibes")


def test_every_fact_carries_its_provenance():
    """The product argues a number without a basis is untrustworthy; shared
    state storing bare values would contradict that at the centre."""
    tw = T.seed("t", destination="Ubud")
    for entry in tw.provenance().values():
        assert entry["source"] and entry["at"]


def test_trusted_requires_a_real_source():
    tw = T.Twin("t")
    tw.record(T.WEATHER, {}, source="inferred")
    assert not tw.trusted(T.WEATHER, at_least="measured")
    tw.record(T.WEATHER, {}, source="measured")
    assert tw.trusted(T.WEATHER, at_least="measured")


class TestEnrichment:
    def _twin(self):
        return T.seed("t", destination="Ubud", start=date(2026, 9, 20),
                      end=date(2026, 9, 30), travellers=2)

    def test_an_enricher_declines_rather_than_inventing_input(self):
        """The packing list once demanded temperatures the caller had to guess."""
        result = enrich.enrich_packing(T.Twin("t"))
        assert not result.ran
        assert "weather" in result.skipped_because

    def test_skipping_is_reported_with_the_missing_key(self):
        report = enrich.run(T.Twin("empty"))
        assert report["ran"] == []
        assert all("needs" in why for why in report["skipped"].values())

    def test_packing_consumes_weather_another_enricher_produced(self):
        """Two modules doing the same network call is the symptom the twin
        exists to remove."""
        tw = self._twin()
        tw.record(T.WEATHER, {"min_temp_c": -4, "max_temp_c": 2,
                              "rain_expected": False}, source="measured")
        assert enrich.enrich_packing(tw).ran
        names = {i["name"] for group in ("cabin", "checked", "either")
                 for i in tw.get(T.PACKING)[group]}
        assert "jacket" in names, "cold weather from the twin should reach the list"

    def test_a_correction_outranks_the_inferred_journey(self):
        tw = T.Twin("t")
        tw.record(T.JOURNEY, {"stops": [{"id": "s1", "place": "Ghost"}],
                              "route": [0]}, source="measured", by="journey")
        tw.record(T.CORRECTIONS, [{"kind": "remove_stop", "target": "s1"}],
                  source="traveller")
        assert enrich.enrich_corrections(tw).ran
        assert tw.get(T.JOURNEY)["stops"] == []
        assert tw.fact(T.JOURNEY).source == "traveller"

    def test_enrichers_never_import_each_other(self):
        """The architectural rule. Thirty modules is 435 possible pairs; nobody
        writes 435 callers."""
        import inspect

        source = inspect.getsource(enrich)
        for name in ("enrich_weather", "enrich_packing", "enrich_journey"):
            body = source.split(f"def {name}")[1].split("\ndef ")[0]
            others = [o for o in ("enrich_weather", "enrich_packing",
                                  "enrich_journey", "enrich_rights") if o != name]
            assert not any(o + "(" in body for o in others)
