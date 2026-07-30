"""The gates that must never open by accident.

Every test here guards a decision that, if it silently flipped, would let the
system do the one thing it promises not to: publish something the traveller did
not agree to, or leak a location they did not mean to share.

These are the highest-value tests in the project because the failure mode is
silent. A broken consent gate does not raise — it just generates.
"""
from __future__ import annotations

import io

import pytest
from PIL import Image

from app.evidence import sensitivity, truth


def _claim(cid: str, status: str, text: str = "a moment") -> dict:
    return {"id": cid, "status": status, "text": text, "confidence": 0.8}


class TestConsentGate:
    def test_nothing_is_generatable_before_consent(self):
        """The empty list IS the product. An INFERRED claim is a plan, not a
        memory, and generating it unasked is how AI invents someone's past."""
        claims = [_claim("c1", "INFERRED"), _claim("c2", "VERIFIED"),
                  _claim("c3", "UNKNOWN"), _claim("c4", "CONTRADICTED")]
        generatable = [c["id"] for c in claims if truth.may_generate(c)]
        assert "c1" not in generatable, "INFERRED must never generate without consent"
        assert "c3" not in generatable, "UNKNOWN must never generate"
        assert "c4" not in generatable, "CONTRADICTED must never generate"

    def test_only_apply_consent_can_promote_a_claim(self):
        """USER_CONFIRMED is the single promotion path. If any other code can
        set it, the gate is decorative."""
        claims = [_claim("c1", "INFERRED")]
        assert not truth.may_generate(claims[0])

        promoted = truth.apply_consent(claims, {"c1": "confirmed"})
        confirmed = [c for c in promoted if c["status"] == "USER_CONFIRMED"]
        assert len(confirmed) == 1
        assert truth.may_generate(confirmed[0])

    def test_denial_does_not_promote(self):
        claims = [_claim("c1", "INFERRED")]
        result = truth.apply_consent(claims, {"c1": "denied"})
        assert not any(truth.may_generate(c) for c in result), \
            "a denied claim must stay ungeneratable"

    def test_silence_does_not_promote(self):
        """No answer must mean no. Defaulting to yes is precisely the harm the
        'invasive and creepy' complaints describe."""
        claims = [_claim("c1", "INFERRED")]
        result = truth.apply_consent(claims, {})
        assert not any(truth.may_generate(c) for c in result)

    def test_confirmed_claims_still_require_disclosure(self):
        """Consent permits generation; it does not make the result real."""
        claims = truth.apply_consent([_claim("c1", "INFERRED")], {"c1": "confirmed"})
        assert truth.disclosure_required(claims[0]), \
            "a recreated moment must be labelled even when consented"


class TestSensitivityDefaults:
    def test_unanswered_prompts_fall_back_to_exclude_or_private(self):
        prompts = [
            {"id": "a", "default": sensitivity.EXCLUDE, "options": []},
            {"id": "b", "default": sensitivity.PRIVATE_ONLY, "options": []},
        ]
        resolved = sensitivity.apply_sensitivity(prompts, {})
        assert resolved["decisions"]["a"] == sensitivity.EXCLUDE
        assert resolved["decisions"]["b"] == sensitivity.PRIVATE_ONLY
        assert resolved["public_safe"] == [], "silence must never mark something public"

    def test_public_cut_drops_private_only_scenes(self):
        scenes = [{"id": 1, "sensitivity_tags": ["people"]},
                  {"id": 2, "sensitivity_tags": []}]
        state = {"excluded": [], "private_only": ["people"], "public_safe": []}
        public = sensitivity.filter_for_audience(scenes, state, audience="public")
        private = sensitivity.filter_for_audience(scenes, state, audience="private")
        assert [s["id"] for s in public] == [2]
        assert [s["id"] for s in private] == [1, 2]

    def test_location_is_generalised_not_trimmed(self):
        """Place strings run specific -> general, so keeping the FIRST component
        would keep the most precise part and defeat the control entirely."""
        cleaned = sensitivity.strip_precise_location(
            {"place": "Uluwatu, Bali, Indonesia", "gps": (1.0, 2.0)},
            {"public_safe": []})
        assert cleaned["place"] == "Indonesia"
        assert "gps" not in cleaned


class TestGpsScrub:
    @staticmethod
    def _jpeg_with_gps() -> bytes:
        import piexif

        image = Image.new("RGB", (64, 48), (120, 140, 160))
        buf = io.BytesIO()
        image.save(buf, "JPEG")
        exif = {"0th": {}, "Exif": {piexif.ExifIFD.DateTimeOriginal: b"2026:06:02 18:30:00"},
                "GPS": {piexif.GPSIFD.GPSLatitudeRef: b"S",
                        piexif.GPSIFD.GPSLatitude: ((8, 1), (30, 1), (0, 1)),
                        piexif.GPSIFD.GPSLongitudeRef: b"E",
                        piexif.GPSIFD.GPSLongitude: ((115, 1), (15, 1), (0, 1))},
                "1st": {}, "thumbnail": None}
        out = io.BytesIO()
        piexif.insert(piexif.dump(exif), buf.getvalue(), out)
        return out.getvalue()

    def test_gps_is_actually_removed_from_the_bytes(self):
        """The regression that matters. The first version returned the ORIGINAL
        bytes on failure, so the caller believed the image was clean and
        published coordinates anyway."""
        import piexif

        original = self._jpeg_with_gps()
        assert piexif.load(original).get("GPS"), "fixture must start with GPS"

        scrubbed = sensitivity.scrub_image_gps(original)
        assert not piexif.load(scrubbed).get("GPS"), "GPS survived the scrub"

    def test_timestamp_survives_the_scrub(self):
        """Stripping location must not cost the timeline its ordering."""
        import piexif

        scrubbed = sensitivity.scrub_image_gps(self._jpeg_with_gps())
        assert piexif.load(scrubbed)["Exif"][piexif.ExifIFD.DateTimeOriginal] \
            == b"2026:06:02 18:30:00"

    def test_image_still_decodes_after_scrub(self):
        image = Image.open(io.BytesIO(sensitivity.scrub_image_gps(self._jpeg_with_gps())))
        assert image.size == (64, 48)

    def test_image_without_exif_passes_through_untouched(self):
        buf = io.BytesIO()
        Image.new("RGB", (8, 8)).save(buf, "PNG")
        raw = buf.getvalue()
        assert sensitivity.scrub_image_gps(raw) == raw

    def test_failure_raises_rather_than_returning_unsafe_bytes(self):
        """A privacy function that silently no-ops is worse than none: the
        caller believes the image is clean and publishes it."""
        import piexif

        original = self._jpeg_with_gps()

        def explode(*args, **kwargs):
            raise ValueError("simulated piexif failure")

        real_insert = piexif.insert
        piexif.insert = explode
        try:
            with pytest.raises(sensitivity.ScrubFailed):
                sensitivity.scrub_image_gps(original)
        finally:
            piexif.insert = real_insert
