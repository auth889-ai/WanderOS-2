"""Sequencing the camera so a film reads as edited, not assembled.

Ken Burns motion applied independently per scene is what makes automated films
feel machine-made: the camera lurches to a new direction at every cut, and the
viewer's eye is thrown each time. Editors avoid that with **motion matching** —
a shot ending on a push-in cuts to a shot beginning on a push-in, so movement
carries across the join and the cut becomes invisible.

Three rules taken from how travel films are actually cut:

**Match movement across the cut.** Consecutive scenes get compatible moves. A
push-in followed by a push-in reads as one continuous camera; a push-in followed
by a pan-right reads as two clips stuck together.

**Vary, but never randomly.** Six identical push-ins is as lifeless as six
random directions is chaotic. The sequence works in phrases — a run of matched
moves, then a deliberate change on a beat, which is where an editor would place
one.

**Let the content decide.** A wide landscape wants a slow push; a detail shot
wants to pull out and reveal. Where the scene knows its own origin, that
preference wins over the pattern.

Deterministic from a seed, so the same trip always cuts the same way. A film
that recuts itself differently on every render cannot be reviewed or approved,
and approval is a load-bearing part of this product.
"""
from __future__ import annotations

import random
from dataclasses import dataclass

# Moves that read as continuous when adjacent. A pan and a zoom in the same
# frame direction share a vector; opposite pans fight each other.
COMPATIBLE = {
    "in": ("in", "up", "down"),
    "out": ("out", "left", "right"),
    "left": ("left", "out", "up"),
    "right": ("right", "out", "down"),
    "up": ("up", "in", "left"),
    "down": ("down", "in", "right"),
}
ALL_MOVES = ("in", "out", "left", "right", "up", "down")

# A phrase is a run of matched moves before a deliberate change. Two is too
# twitchy to register as intent; four starts to feel like a stuck camera.
PHRASE_MIN, PHRASE_MAX = 2, 3

# What the material itself asks for, when it says.
ORIGIN_PREFERENCE = {
    "recreated": "in",     # push into a generated scene; it rewards inspection least at the edges
    "clip": None,          # real footage already moves — leave it alone
}

# Crossfade length. Long enough to blend the motion, short enough that a
# 4-second scene is not half dissolve.
MATCHED_FADE = 0.5
CHANGE_FADE = 0.8          # a deliberate change gets a longer, softer join


@dataclass
class Cut:
    index: int
    direction: str
    fade_in: float
    matched: bool          # does the motion carry from the previous scene?
    reason: str = ""

    def as_dict(self) -> dict:
        return dict(self.__dict__)


def sequence(origins: list[str], *, seed: int = 0) -> list[Cut]:
    """Choose a camera move per scene so the film cuts like an edit.

    `origins` are the scene origins (photo / parallax / recreated / clip), in
    order. Returns one Cut per scene.
    """
    rng = random.Random(seed)
    cuts: list[Cut] = []
    previous: str | None = None
    phrase_left = rng.randint(PHRASE_MIN, PHRASE_MAX)

    for index, origin in enumerate(origins):
        preferred = ORIGIN_PREFERENCE.get(origin)

        if previous is None:
            direction = preferred or rng.choice(ALL_MOVES)
            cuts.append(Cut(index, direction, 0.0, matched=False,
                            reason="opening shot"))
            previous = direction
            phrase_left -= 1
            continue

        if phrase_left > 0:
            # Continue the phrase: pick a move that reads as the same camera.
            options = [m for m in COMPATIBLE[previous] if m != previous] or [previous]
            direction = preferred if preferred in COMPATIBLE[previous] else (
                previous if rng.random() < 0.55 else rng.choice(options))
            cuts.append(Cut(index, direction, MATCHED_FADE, matched=True,
                            reason=f"motion carries from '{previous}'"))
            phrase_left -= 1
        else:
            # Deliberate change — the beat an editor would cut on.
            opposites = [m for m in ALL_MOVES if m not in COMPATIBLE[previous]]
            direction = preferred or (rng.choice(opposites) if opposites
                                      else rng.choice(ALL_MOVES))
            cuts.append(Cut(index, direction, CHANGE_FADE, matched=False,
                            reason="deliberate change of direction"))
            phrase_left = rng.randint(PHRASE_MIN, PHRASE_MAX)

        previous = direction

    return cuts


def summarise(cuts: list[Cut]) -> dict:
    matched = sum(1 for c in cuts if c.matched)
    runs, current = [], 1
    for i in range(1, len(cuts)):
        if cuts[i].matched:
            current += 1
        else:
            runs.append(current)
            current = 1
    runs.append(current)
    return {
        "scenes": len(cuts),
        "matched_cuts": matched,
        "deliberate_changes": len(cuts) - matched - 1,   # the opening is neither
        "longest_phrase": max(runs) if runs else 0,
        "directions": [c.direction for c in cuts],
        "note": ("Movement carries across matched cuts so the camera reads as "
                 "continuous; changes land where an editor would place one."),
    }
