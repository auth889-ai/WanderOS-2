"""Rescue Hero Reel — a beat must be earned or absent.

The reference concept showed "148 options analyzed" and "stress avoided 100%".
Inventing hero numbers would make this marketing rendered as video, which is the
one thing this product argues against.
"""
from __future__ import annotations

from app.media import rescue_reel as rr


def plan(**over):
    base = {
        "impact": {"flight": "BA112", "status": "cancelled", "delay_hours": 5.5,
                   "new_arrival": "2026-06-01T23:30:00",
                   "at_risk": [{"name": "Transfer", "refundable": True}],
                   "broken": []},
        "actions": [{"title": "a"}, {"title": "b"}, {"title": "c"}],
        "do_now": ["Cancel or move 'Airport transfer'"],
    }
    base.update(over)
    return base


def entitlement(amount=520, currency="GBP"):
    return {"headline_amount": amount,
            "entitlements": [{"amount": amount, "currency": currency}]}


def test_a_full_recovery_produces_the_story():
    beats, dropped = rr.beats_from_recovery(plan(), entitlement(), walking_km_saved=6.3)
    keys = [b.key for b in beats]
    assert "disruption" in keys and "money" in keys and "arrival" in keys


def test_walking_is_never_claimed_unless_measured():
    """It cannot be derived from a booking record, so guessing it would be the
    exact failure this module refuses."""
    _, dropped = rr.beats_from_recovery(plan(), entitlement())
    assert any("walking" in d for d in dropped)

    beats, _ = rr.beats_from_recovery(plan(), entitlement(), walking_km_saved=6.3)
    assert any(b.key == "walking" for b in beats)


def test_no_compensation_means_no_money_beat():
    beats, dropped = rr.beats_from_recovery(plan(), {"headline_amount": None})
    assert not any(b.key == "money" for b in beats)
    assert any("money" in d for d in dropped)


def test_the_money_beat_carries_the_currency():
    beats, _ = rr.beats_from_recovery(plan(), entitlement(520, "GBP"))
    money = next(b for b in beats if b.key == "money")
    assert "GBP" in money.value and "520" in money.value


def test_options_beat_reports_what_was_actually_evaluated():
    """Not a headline number — the count of actions the engine really produced."""
    beats, _ = rr.beats_from_recovery(plan(actions=[{"t": 1}] * 4), entitlement())
    analysed = next(b for b in beats if b.key == "analysed")
    assert analysed.value == "4"


def test_every_dropped_beat_says_why():
    _, dropped = rr.beats_from_recovery(
        {"impact": {}, "actions": [], "do_now": []}, None)
    assert dropped
    assert all("—" in d for d in dropped)


def test_a_thin_story_produces_no_film(tmp_path):
    """Two cards is a notification, not a film."""
    reel = rr.build({"impact": {}, "actions": [], "do_now": []},
                    tmp_path / "r.mp4", entitlement=None)
    assert reel.path is None
    assert len(reel.beats) < 3


def test_a_real_recovery_renders_a_vertical_file(tmp_path):
    reel = rr.build(plan(), tmp_path / "r.mp4", entitlement=entitlement(),
                    walking_km_saved=6.3, work_dir=tmp_path / "frames")
    assert reel.path and reel.path.exists()
    assert reel.seconds == len(reel.beats) * rr.BEAT_SECONDS
    assert (rr.W, rr.H) == (1080, 1920), "made to be shared, not embedded"
