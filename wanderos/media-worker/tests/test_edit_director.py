"""Camera sequencing — a film should read as edited, not assembled."""
from __future__ import annotations

from app.media import edit_director as ed


def origins(n=8):
    return ["photo", "parallax", "photo", "recreated", "photo", "clip", "photo", "photo"][:n]


def test_consecutive_moves_are_compatible_within_a_phrase():
    """A push-in cutting to a pan-right reads as two clips stuck together."""
    cuts = ed.sequence(origins(), seed=7)
    for prev, cur in zip(cuts, cuts[1:]):
        if cur.matched:
            assert cur.direction in ed.COMPATIBLE[prev.direction], \
                f"{prev.direction} -> {cur.direction} does not carry"


def test_the_film_is_not_one_repeated_move():
    """Six identical push-ins is as lifeless as six random directions is chaotic."""
    directions = [c.direction for c in ed.sequence(origins(), seed=7)]
    assert len(set(directions)) > 1


def test_it_is_not_random_either():
    """Randomness is the failure this exists to fix — matched cuts must dominate."""
    cuts = ed.sequence(origins(), seed=7)
    matched = sum(1 for c in cuts if c.matched)
    assert matched >= len(cuts) // 2


def test_deliberate_changes_get_a_longer_fade():
    cuts = ed.sequence(origins(), seed=7)
    changes = [c for c in cuts[1:] if not c.matched]
    assert changes, "a film of only matched cuts has no punctuation"
    assert all(c.fade_in == ed.CHANGE_FADE for c in changes)
    assert all(c.fade_in == ed.MATCHED_FADE for c in cuts[1:] if c.matched)


def test_the_opening_shot_has_no_fade_in():
    assert ed.sequence(origins(), seed=3)[0].fade_in == 0.0


def test_sequencing_is_deterministic():
    """A film that recuts itself every render cannot be reviewed or approved —
    and approval is load-bearing here."""
    a = [c.direction for c in ed.sequence(origins(), seed=7)]
    b = [c.direction for c in ed.sequence(origins(), seed=7)]
    assert a == b


def test_different_seeds_give_different_cuts():
    a = [c.direction for c in ed.sequence(origins(), seed=7)]
    b = [c.direction for c in ed.sequence(origins(), seed=99)]
    assert a != b


def test_phrases_do_not_run_forever():
    """Four matched cuts starts to feel like a stuck camera."""
    summary = ed.summarise(ed.sequence(origins(12), seed=5))
    assert summary["longest_phrase"] <= ed.PHRASE_MAX + 1


def test_a_single_scene_still_works():
    cuts = ed.sequence(["photo"], seed=1)
    assert len(cuts) == 1 and not cuts[0].matched


def test_every_cut_explains_itself():
    for cut in ed.sequence(origins(), seed=7):
        assert cut.reason
