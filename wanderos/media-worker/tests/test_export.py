"""Cross-app export — a travel tool that only works inside its own app has lost."""
from __future__ import annotations

import zipfile
from datetime import date, datetime
from pathlib import Path

from app.journey import export
from app.journey import twin as T


def twin():
    tw = T.seed("t", destination="Reykjavik", start=date(2026, 8, 6),
                end=date(2026, 8, 13), travellers=2)
    tw.record(T.FLIGHT, {"flight_iata": "FI451", "arrival_airport": "KEF",
                         "scheduled_arrival": "2026-08-06T18:00:00"},
              source="traveller")
    return tw


class TestCalendar:
    def test_ics_uses_crlf_line_endings(self):
        """Calendars are forgiving about folding and unforgiving about CRLF."""
        ics = export.to_ics([export.Event("X", datetime(2026, 8, 6, 9, 0))], trip_id="t")
        assert "\r\n" in ics
        assert not ics.replace("\r\n", "").count("\n")

    def test_commas_are_escaped(self):
        """An unescaped comma silently truncates the field."""
        ics = export.to_ics([export.Event("Dinner, then a walk",
                                          datetime(2026, 8, 6, 19, 0))], trip_id="t")
        assert r"Dinner\, then a walk" in ics

    def test_long_lines_are_folded(self):
        """Strict parsers reject the whole file over one long line."""
        ics = export.to_ics([export.Event("x" * 200, datetime(2026, 8, 6, 9, 0))],
                            trip_id="t")
        assert all(len(line) <= 76 for line in ics.split("\r\n"))

    def test_uids_are_stable_across_regeneration(self):
        """An unstable UID makes every re-export a duplicate in the calendar."""
        event = export.Event("Trip", datetime(2026, 8, 6, 9, 0))
        assert event.uid("t") == event.uid("t")

    def test_only_known_facts_become_events(self):
        """A calendar full of guesses is worse than a sparse one."""
        bare = export.events_from_twin(T.Twin("empty"))
        assert bare == []

        full = export.events_from_twin(twin())
        assert any("FI451" in e.summary for e in full)

    def test_a_flight_gets_a_reminder(self):
        flight = next(e for e in export.events_from_twin(twin())
                      if "FI451" in e.summary)
        assert flight.alarm_minutes


class TestDeepLinks:
    def test_map_links_cover_every_platform(self):
        links = export.map_link("Reykjavik", lat=64.1, lon=-21.9)
        assert {"apple", "google", "osm", "geo"} <= set(links)
        assert all(v for v in links.values())

    def test_share_links_are_plain_urls(self):
        """No SDK, no partnership — an app-only link is broken for anyone
        without the app."""
        links = export.share_links("My trip", "https://example.com/s/1")
        assert links["email"].startswith("mailto:")
        assert links["whatsapp"].startswith("https://")


class TestWalletPass:
    def test_the_bundle_is_structurally_valid(self, tmp_path):
        result = export.build_pass(twin(), tmp_path / "t.pkpass")
        with zipfile.ZipFile(result["path"]) as bundle:
            assert {"pass.json", "manifest.json"} <= set(bundle.namelist())

    def test_it_reports_that_it_is_unsigned(self, tmp_path):
        """Wallet silently refuses an unsigned pass. Claiming otherwise would
        ship something that looks finished and fails on a phone."""
        result = export.build_pass(twin(), tmp_path / "t.pkpass")
        assert result["signed"] is False
        assert result["installable"] is False
        assert "certificate" in result["reason"]

    def test_the_pass_carries_provenance(self, tmp_path):
        import json

        result = export.build_pass(twin(), tmp_path / "t.pkpass")
        with zipfile.ZipFile(result["path"]) as bundle:
            payload = json.loads(bundle.read("pass.json"))
        back = payload["generic"]["backFields"][0]["value"]
        assert "traveller" in back


def test_bundle_produces_a_readable_calendar(tmp_path):
    out = export.bundle(twin(), tmp_path, public_url="https://example.com/s/1")
    assert out["calendar"]["events"] >= 2
    assert Path(out["calendar"]["path"]).read_text().startswith("BEGIN:VCALENDAR")
    assert out["share"] and out["maps"]
