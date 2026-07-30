"""Offline pack and safety card invariants.

Two properties here are security properties, not features: the pack must contain
no secrets, and it must make no network request. Both fail silently — a pack
that quietly embeds a card number still opens correctly, and one that fetches a
font still works on the wifi where it was built and only fails in the airport.
"""
from __future__ import annotations

import re
from datetime import date, datetime

from app.planning import offline, safety


class TestEmergencyNumbers:
    def test_numbers_differ_by_country(self):
        """The whole point: 911 is not universal, and guessing wastes the call."""
        assert safety.emergency_numbers("US")["general"] == "911"
        assert safety.emergency_numbers("GB")["general"] == "999"
        assert safety.emergency_numbers("AU")["general"] == "000"
        assert safety.emergency_numbers("JP")["police"] == "110"

    def test_unknown_country_admits_it_rather_than_guessing(self):
        result = safety.emergency_numbers("ZZ")
        assert result["known"] is False
        assert "advice" in result

    def test_japan_has_no_single_general_number(self):
        """Japan splits police and ambulance. Inventing a 'general' number here
        would send someone to the wrong service in an emergency."""
        japan = safety.emergency_numbers("JP")
        assert "general" not in japan
        assert japan["police"] and japan["ambulance"]

    def test_local_language_phrases_are_selected(self):
        assert safety.phrases_for("ID")["language"] == "id"
        assert safety.phrases_for("JP")["language"] == "ja"
        assert safety.phrases_for("ZZ")["language"] == "en", "unknown falls back to English"

    def test_gaps_name_what_is_missing_while_it_can_be_fixed(self):
        bare = safety.safety_card(destination_country="ID")
        missing = safety.gaps(bare)
        assert any("emergency contact" in g for g in missing)
        assert any("insurance" in g for g in missing)

    def test_advisory_is_linked_never_paraphrased(self):
        """A summarised travel warning that is subtly wrong is more dangerous
        than a link to the real one."""
        card = safety.safety_card(destination_country="ID", home_country="GB")
        assert card["advisory_source"].startswith("https://www.gov.uk/")
        assert "summaris" in card["advisory_note"] or "paraphras" in card["advisory_note"]


class TestOfflinePack:
    def _pack(self):
        card = safety.safety_card(
            destination_country="ID", home_country="GB",
            contacts=[safety.EmergencyContact("Kin", "brother", "+8801711000000")],
            medical=safety.MedicalInfo(blood_type="O+", allergies=["penicillin"],
                                       insurance_phone="+442071000000"))
        return offline.from_trip(
            "Bali 2026", "Ubud, Indonesia", start=date(2026, 9, 20), end=date(2026, 10, 2),
            safety=card,
            bookings=[offline.PackEntry("Hotel", reference="ALS-77213",
                                        address="Jl. Taman Ganesha 9", phone="+623611000000")],
            addresses=[offline.PackEntry("Embassy", address="Jl. Patra Kuningan")],
            itinerary=[offline.PackEntry("Uluwatu sunset", when="Day 2, 17:30")])

    def test_pack_makes_no_external_request(self):
        """A pack that fetches a font works on the wifi where it was built and
        fails in the airport where it is needed."""
        built = offline.build(self._pack(), now=datetime(2026, 9, 18, 10, 0))
        links = re.findall(r'(?:src|href)="(?!tel:|#)([^"]+)"', built["html"])
        assert links == [], f"offline pack referenced {links}"
        assert built["external_requests"] == 0

    def test_secrets_are_redacted_whatever_the_field_is_called(self):
        """An offline file travels in the same pocket as the phone that gets
        stolen, so the redaction is on CONTENT, not on a field whitelist."""
        pack = self._pack()
        pack.bookings.append(offline.PackEntry(
            "Payment", detail="card_number 4111 1111 1111 1111"))
        pack.bookings.append(offline.PackEntry("Docs", reference="passport_number X1234567"))
        built = offline.build(pack)
        assert "4111 1111 1111 1111" not in built["html"]
        assert "X1234567" not in built["html"]
        assert "[removed" in built["html"]

    def test_emergency_number_is_dialable_offline(self):
        """tel: is the one link worth having — it works with no data."""
        built = offline.build(self._pack())
        assert 'href="tel:112"' in built["html"]

    def test_pack_is_hashed_so_a_later_download_is_provably_the_same(self):
        first = offline.build(self._pack(), now=datetime(2026, 9, 18, 10, 0))
        again = offline.build(self._pack(), now=datetime(2026, 9, 18, 10, 0))
        assert first["sha256"] == again["sha256"], "same input must hash identically"
        assert len(first["sha256"]) == 64

    def test_contents_manifest_reports_what_actually_went_in(self):
        built = offline.build(self._pack())
        assert built["contents"] == {
            "bookings": 1, "addresses": 1, "itinerary": 1,
            "has_emergency_numbers": True, "has_contacts": True, "has_phrases": True}

    def test_html_escapes_user_supplied_text(self):
        """Trip titles come from users; an unescaped one is stored XSS in a file
        that gets opened on someone's phone."""
        pack = self._pack()
        pack.trip_title = '<script>alert(1)</script>'
        built = offline.build(pack)
        assert "<script>alert(1)</script>" not in built["html"]
        assert "&lt;script&gt;" in built["html"]

    def test_pack_states_it_works_without_a_network(self):
        built = offline.build(self._pack())
        assert "no internet" in built["html"].lower()
