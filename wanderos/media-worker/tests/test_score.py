"""Music bed — mood inference and graceful absence.

Music is the most decorative part of a film and the most likely to hit a
provider quirk, so the invariant that matters is that its absence never fails a
render.
"""
from __future__ import annotations

from app.media import score


def test_mood_comes_from_what_the_scenes_are_of():
    assert score.infer_mood(["sunset over the ocean", "beach walk"]) == "coastal"
    assert score.infer_mood(["Kyoto street", "museum quarter"]) == "urban"
    assert score.infer_mood(["glacier", "snow field"]) == "cold"
    assert score.infer_mood(["rice terrace", "temple"]) == "tropical"


def test_unrecognised_labels_fall_back_to_a_neutral_bed():
    """A wrong guess is harmless; a confident wrong guess is not. The fallback
    is deliberately the least characterful option."""
    assert score.infer_mood(["nothing recognisable"]) == score.DEFAULT_MOOD
    assert score.infer_mood([]) == score.DEFAULT_MOOD


def test_every_mood_has_a_prompt():
    for mood in set(score.MOOD_HINTS) | {score.DEFAULT_MOOD}:
        assert mood in score.MOOD_PROMPTS


def test_every_prompt_asks_for_instrumental():
    """A vocal track competes with the narration it exists to support."""
    for prompt in score.MOOD_PROMPTS.values():
        assert "instrumental" in prompt


def test_missing_key_degrades_instead_of_raising(monkeypatch):
    monkeypatch.setattr(score.settings, "gmi_api_key", "", raising=False)
    result = score.generate("j", "t", labels=["beach"])
    assert result.available is False
    assert result.path is None
    assert "without music" in result.reason
    # The mood is still decided, so a caller can report what it would have been.
    assert result.mood == "coastal"


def test_a_provider_failure_never_raises(monkeypatch):
    """Insufficient credits, a 500, a renamed class — none of these should cost
    the traveller their film."""
    monkeypatch.setattr(score.settings, "gmi_api_key", "fake-key", raising=False)

    def explode(*a, **kw):
        raise RuntimeError("simulated provider failure")

    monkeypatch.setattr(score, "_instrumental_registry", explode)
    result = score.generate("j", "t", labels=["beach"])
    assert result.available is False
    assert "simulated provider failure" in result.reason


def test_score_serialises_for_the_job_record():
    result = score.Score(None, "coastal", "prompt", "model", False, "reason")
    assert result.as_dict()["path"] is None
    assert result.as_dict()["mood"] == "coastal"
