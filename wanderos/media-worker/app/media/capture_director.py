"""Feature 25 — Live Capture Director.

Every gap in a story has two possible endings. The system can generate something
plausible, or the traveller can go and photograph the real thing — and for a
gap noticed *while they are still there*, the second is always better and
usually takes ninety seconds.

This is the anti-generation feature, and it is the most on-thesis thing in the
project. Everywhere else we refuse to invent a missing moment; here we do
something more useful than refusing. We tell the traveller, on day two, that the
film is going to be missing a wide shot of the place they are standing in.

**Timing is the whole feature.** A gap identified after the trip can only be
generated or left empty. The same gap identified on the morning of day three is
just a thing to go and shoot. So prompts are ranked by how soon the opportunity
closes, not by how important the shot is:

    LEAVING_TODAY      hours left — say it now
    STILL_HERE         days left at this place
    RETURNING          they pass back through
    GONE               unreachable; the consent gate is the only remaining path

**It asks for shots, not photos.** "Take more pictures of Ubud" is useless.
"A wide establishing shot of the rice terraces, from the road above, in the hour
before sunset" is a thing a person can actually do — and it is what the story
planner will need.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

# The shot types a story needs and travellers systematically under-shoot.
# Almost everyone comes home with mid-range photos of things and no establishing
# shots, no detail, and nobody's face.
SHOT_TYPES = {
    "establishing": "a wide shot that shows WHERE you were — the story has no sense of place without one",
    "detail": "a close-up of one small thing — texture, a sign, food, hands",
    "human": "a person in the frame, even small — a landscape with nobody in it reads as a postcard",
    "motion": "10 seconds of video, held still — movement does what a photo cannot",
    "transition": "the road, the train window, the walk between — how you got there",
    "ambient_audio": "20 seconds of just sound, phone in your pocket",
}

URGENCY_ORDER = {"leaving_today": 0, "still_here": 1, "returning": 2, "gone": 3}

# Golden hour is worth naming because it is the single easiest quality upgrade
# available to someone with a phone.
GOLDEN_HOUR_HINT = "the hour after sunrise or before sunset, if you can"


@dataclass
class StoryGap:
    """Something the film will be missing."""
    place: str
    needs: list[str] = field(default_factory=list)   # SHOT_TYPES keys
    why: str = ""
    day: int | None = None


@dataclass
class Presence:
    """Where the traveller is and how long they have."""
    place: str
    leaves_on: date | None = None
    returns_later: bool = False


@dataclass
class Prompt:
    place: str
    shot: str
    instruction: str
    urgency: str
    why: str
    seconds_of_effort: int = 90

    def as_dict(self) -> dict:
        return dict(self.__dict__)


def _urgency(presence: Presence | None, today: date) -> str:
    if presence is None:
        return "gone"
    if presence.leaves_on is None:
        return "still_here"
    if presence.leaves_on <= today:
        return "leaving_today"
    if presence.leaves_on <= today + timedelta(days=1):
        return "leaving_today"
    return "still_here"


def direct(gaps: list[StoryGap], presence: list[Presence], *,
           today: date | None = None, limit: int = 5) -> dict:
    """Turn story gaps into shots the traveller can still take.

    Capped deliberately. A list of twenty requests gets ignored entirely, and
    the traveller is on holiday — this is meant to cost them a couple of minutes
    a day, not turn the trip into an assignment.
    """
    today = today or date.today()
    here = {p.place.strip().lower(): p for p in presence}
    prompts: list[Prompt] = []

    for gap in gaps:
        at = here.get(gap.place.strip().lower())
        urgency = _urgency(at, today)
        if urgency == "gone":
            continue  # nothing to ask for; the consent gate handles it instead

        for shot in gap.needs:
            description = SHOT_TYPES.get(shot)
            if not description:
                continue
            instruction = description
            if shot in ("establishing", "detail"):
                instruction += f" — {GOLDEN_HOUR_HINT}"
            prompts.append(Prompt(
                place=gap.place,
                shot=shot,
                instruction=instruction,
                urgency=urgency,
                why=gap.why or f"the film has no {shot.replace('_', ' ')} shot of {gap.place}",
                seconds_of_effort=120 if shot in ("motion", "ambient_audio") else 60,
            ))

    prompts.sort(key=lambda p: (URGENCY_ORDER[p.urgency], -len(p.why)))
    shown = prompts[:limit]

    unreachable = [g.place for g in gaps
                   if g.place.strip().lower() not in here]
    return {
        "prompts": [p.as_dict() for p in shown],
        "held_back": max(0, len(prompts) - len(shown)),
        "leaving_today": [p.as_dict() for p in shown if p.urgency == "leaving_today"],
        # The honest half: these can no longer be captured, so the only remaining
        # options are the consent gate or an empty gap card.
        "no_longer_reachable": unreachable,
        "total_effort_seconds": sum(p.seconds_of_effort for p in shown),
        "principle": ("Ranked by how soon the chance closes, not by how important the "
                      "shot is. A gap found while you are still there is a thing to go "
                      "and photograph; the same gap found at home can only be generated "
                      "or left empty."),
    }


def coverage(captured: dict[str, list[str]], places: list[str]) -> dict:
    """What the story still lacks, per place.

    `captured` maps place -> shot types already taken. Used both to stop asking
    for a shot the traveller already got and to show honest progress, because a
    prompt list that never shrinks is a prompt list people mute.
    """
    report = {}
    for place in places:
        have = set(captured.get(place, []))
        missing = [s for s in ("establishing", "detail", "human", "motion") if s not in have]
        report[place] = {
            "have": sorted(have),
            "missing": missing,
            "complete": not missing,
            # Establishing is weighted because its absence is what makes a film
            # feel like a photo dump rather than a place.
            "story_ready": "establishing" in have and len(have) >= 2,
        }
    ready = sum(1 for r in report.values() if r["story_ready"])
    return {"places": report, "story_ready_count": ready, "total_places": len(places)}
