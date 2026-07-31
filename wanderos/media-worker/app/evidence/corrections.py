"""The traveller can overrule the map — and the correction is itself evidence.

The most-repeated complaint about the largest app in this category is that its
GPS log records "phantom flights" and places you never went, **and there is no
way to delete them**. Your own travel history tells a story you know is false and
you cannot fix it.

That is not a mapping bug. It is an authority question: when the system's
inference and the traveller's memory disagree, who wins? Everywhere else in this
project the answer is already the traveller — a claim they will not confirm is
never generated. This applies the same rule to the timeline itself.

Three properties that make this more than an edit button:

**A correction is a first-class claim, not a deletion.** Removing a phantom stop
does not erase the record that GPS once asserted it. The original inference, the
correction, the reason and the time are all kept, so the map can be re-derived
and the correction can be audited. Silently rewriting history would make this
system exactly as untrustworthy as the one it is fixing.

**Corrections outrank inference permanently.** Re-running extraction over the
same photos must not resurrect a stop the traveller already rejected. This is
the same rule as a stated trait in Traveler DNA overriding a learned one: people
know things the data does not.

**Corrections are USER_CONFIRMED evidence.** "I was never in Frankfurt" is a
statement of fact by the person who was there, and it is stronger evidence than
a GPS point from a phone that connected to an airport wifi during a layover.
Once made, it can be sealed and signed like any other claim.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

# What a traveller can say about their own timeline.
REMOVE_STOP = "remove_stop"        # "I was never there"
MERGE_STOPS = "merge_stops"        # "these are the same place"
SPLIT_STOP = "split_stop"          # "these were two separate visits"
RELABEL_STOP = "relabel_stop"      # "this is called something else"
ADD_STOP = "add_stop"              # "you missed this — I have no photo of it"
REORDER = "reorder"                # "I went here before there"
MERGE_TRIPS = "merge_trips"        # the other named missing feature
SPLIT_TRIP = "split_trip"

KINDS = (REMOVE_STOP, MERGE_STOPS, SPLIT_STOP, RELABEL_STOP, ADD_STOP,
         REORDER, MERGE_TRIPS, SPLIT_TRIP)

# Reasons offered in the UI. Free text is allowed, but naming the common cases
# makes the pattern visible across trips — a layover is the usual culprit.
COMMON_REASONS = {
    "layover": "I only changed planes here",
    "never_visited": "I was never at this place",
    "wrong_place": "The place name is wrong",
    "same_place": "These are the same place recorded twice",
    "phone_error": "My phone recorded this incorrectly",
    "someone_else": "This is not my location",
}


@dataclass
class Correction:
    kind: str
    target: str                       # stop id, or "a+b" for a merge
    reason: str = ""
    replacement: dict[str, Any] = field(default_factory=dict)
    corrected_at: str = ""
    corrected_by: str = "traveller"
    # What the system had claimed, kept verbatim so the correction is auditable.
    original: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self):
        if self.kind not in KINDS:
            raise ValueError(f"unknown correction kind: {self.kind}")
        if not self.corrected_at:
            self.corrected_at = datetime.now(timezone.utc).isoformat()

    def as_dict(self) -> dict:
        return dict(self.__dict__)

    def fingerprint(self) -> str:
        """Stable id for this correction, so re-applying it is idempotent."""
        blob = json.dumps({"kind": self.kind, "target": self.target,
                           "replacement": self.replacement},
                          sort_keys=True, default=str).encode()
        return hashlib.sha256(blob).hexdigest()[:16]


def _stop_id(stop: dict, index: int) -> str:
    return str(stop.get("id") or stop.get("place") or f"stop-{index}")


def _matches(stop: dict, index: int, target: str) -> bool:
    """Does `target` refer to this stop?

    Accepts the internal id OR the place name. A traveller correcting their own
    map thinks in place names ("I was never in Frankfurt"), while the UI passes
    ids — and a correction that is silently rejected because the caller used the
    human name is a correction the traveller believes they made. Matching both
    is the difference between a working feature and a confusing one.
    """
    if not target:
        return False
    candidate = target.strip().lower()
    return candidate in {
        _stop_id(stop, index).strip().lower(),
        str(stop.get("id") or "").strip().lower(),
        str(stop.get("place") or "").strip().lower(),
    } - {""}


def apply_corrections(journey: dict, corrections: list[Correction]) -> dict:
    """Return a corrected journey plus a full record of what changed.

    The input journey is never mutated: the original inference has to survive so
    the correction can be shown against it.
    """
    stops = [dict(s) for s in (journey.get("stops") or [])]
    route = list(journey.get("route") or range(len(stops)))
    applied: list[dict] = []
    rejected: list[dict] = []

    for correction in corrections:
        index = next((i for i, s in enumerate(stops)
                      if _matches(s, i, correction.target)), None)

        if correction.kind == REMOVE_STOP:
            if index is None:
                rejected.append({"correction": correction.as_dict(),
                                 "why": "no such stop — it may already be removed"})
                continue
            removed = stops.pop(index)
            # Route indices shift when a stop goes; rebuilding rather than
            # patching avoids an off-by-one that would silently reorder the trip.
            route = [r for r in route if r != index]
            route = [r - 1 if r > index else r for r in route]
            applied.append({"kind": REMOVE_STOP, "removed": removed,
                            "reason": correction.reason,
                            "at": correction.corrected_at})

        elif correction.kind == RELABEL_STOP:
            if index is None:
                rejected.append({"correction": correction.as_dict(), "why": "no such stop"})
                continue
            before = stops[index].get("place")
            stops[index]["place"] = correction.replacement.get("place", before)
            stops[index]["corrected"] = True
            applied.append({"kind": RELABEL_STOP, "from": before,
                            "to": stops[index]["place"], "reason": correction.reason,
                            "at": correction.corrected_at})

        elif correction.kind == MERGE_STOPS:
            targets = [t.strip() for t in correction.target.split("+")]
            found = [i for i, s in enumerate(stops)
                     if any(_matches(s, i, t) for t in targets)]
            if len(found) < 2:
                rejected.append({"correction": correction.as_dict(),
                                 "why": "need at least two existing stops to merge"})
                continue
            keep, *rest = sorted(found)
            merged_photos = list(stops[keep].get("photos") or [])
            for i in rest:
                merged_photos += list(stops[i].get("photos") or [])
            stops[keep]["photos"] = merged_photos
            stops[keep]["corrected"] = True
            for i in sorted(rest, reverse=True):
                stops.pop(i)
                route = [r for r in route if r != i]
                route = [r - 1 if r > i else r for r in route]
            applied.append({"kind": MERGE_STOPS, "kept": _stop_id(stops[keep], keep),
                            "absorbed": len(rest), "reason": correction.reason,
                            "at": correction.corrected_at})

        elif correction.kind == ADD_STOP:
            # A place with no photo is still a place the traveller went. This is
            # the inverse of the consent gate: the system may not invent a
            # moment, but the traveller may assert one.
            new_stop = {**correction.replacement, "corrected": True,
                        "evidence": "traveller_asserted", "photos": []}
            stops.append(new_stop)
            route.append(len(stops) - 1)
            applied.append({"kind": ADD_STOP, "added": new_stop,
                            "reason": correction.reason, "at": correction.corrected_at})

        elif correction.kind == REORDER:
            new_order = correction.replacement.get("route")
            if not new_order or sorted(new_order) != sorted(range(len(stops))):
                rejected.append({"correction": correction.as_dict(),
                                 "why": "reorder must list every stop exactly once"})
                continue
            route = list(new_order)
            applied.append({"kind": REORDER, "reason": correction.reason,
                            "at": correction.corrected_at})

        else:
            rejected.append({"correction": correction.as_dict(),
                             "why": f"{correction.kind} is applied at trip level, "
                                    "not to a single journey"})

    corrected = {**journey, "stops": stops, "route": route}
    corrected["stats"] = {
        **(journey.get("stats") or {}),
        "places_visited": len(stops),
        "corrections_applied": len(applied),
    }
    return {
        "journey": corrected,
        "applied": applied,
        "rejected": rejected,
        # Kept deliberately: silently rewriting history would make this system
        # exactly as untrustworthy as the one it is fixing.
        "original_stop_count": len(journey.get("stops") or []),
        "audit": [c.as_dict() for c in corrections],
    }


def as_claims(corrections: list[Correction]) -> list[dict]:
    """Corrections expressed as USER_CONFIRMED claims.

    "I was never in Frankfurt" is a statement by the person who was there, and it
    outranks a GPS point from a phone that joined an airport wifi during a
    layover. Expressed as claims, corrections flow into the same sealing and
    provenance path as everything else.
    """
    claims = []
    for correction in corrections:
        claims.append({
            "id": f"correction-{correction.fingerprint()}",
            "status": "USER_CONFIRMED",
            "confidence": 1.0,
            "text": _describe(correction),
            "source": "traveller_correction",
            "reason": correction.reason,
            "corrected_at": correction.corrected_at,
            "overrides": correction.original or None,
        })
    return claims


def _describe(correction: Correction) -> str:
    reason = COMMON_REASONS.get(correction.reason, correction.reason)
    if correction.kind == REMOVE_STOP:
        return f"The traveller states they were never at '{correction.target}'" + \
               (f" ({reason})" if reason else "")
    if correction.kind == RELABEL_STOP:
        return (f"The traveller states '{correction.target}' is actually "
                f"'{correction.replacement.get('place')}'")
    if correction.kind == MERGE_STOPS:
        return f"The traveller states '{correction.target}' are the same place"
    if correction.kind == ADD_STOP:
        return (f"The traveller states they visited "
                f"'{correction.replacement.get('place')}', with no photo evidence")
    if correction.kind == REORDER:
        return "The traveller corrected the order of the trip"
    return f"{correction.kind} on '{correction.target}'"


def suggest_corrections(journey: dict) -> list[dict]:
    """Offer the corrections most likely to be needed, unprompted.

    A correction feature nobody finds is not a feature. The two patterns that
    generate almost all phantom stops are a brief airport touch and two records
    of the same place, so those are surfaced as questions rather than waiting to
    be discovered.
    """
    prompts: list[dict] = []
    stops = journey.get("stops") or []

    for i, stop in enumerate(stops):
        photos = stop.get("photos") or []
        place = str(stop.get("place") or "")
        # A stop with almost no evidence is the classic layover artefact.
        if len(photos) <= 1:
            looks_like_airport = any(
                token in place.lower()
                for token in ("airport", "international", "terminal", "aeropuerto"))
            prompts.append({
                "stop": _stop_id(stop, i),
                "place": place,
                "question": (f"We recorded '{place}' with "
                             f"{len(photos)} photo{'s' if len(photos) != 1 else ''}. "
                             "Did you actually visit, or were you just passing through?"),
                "suggested": REMOVE_STOP if looks_like_airport else None,
                "reason_hint": "layover" if looks_like_airport else "never_visited",
            })

    seen: dict[str, int] = {}
    for i, stop in enumerate(stops):
        key = str(stop.get("place") or "").strip().lower()
        if not key:
            continue
        if key in seen:
            prompts.append({
                "stop": f"{_stop_id(stops[seen[key]], seen[key])}+{_stop_id(stop, i)}",
                "place": stop.get("place"),
                "question": f"'{stop.get('place')}' appears twice. Same place, or two visits?",
                "suggested": MERGE_STOPS,
                "reason_hint": "same_place",
            })
        seen[key] = i

    return prompts
