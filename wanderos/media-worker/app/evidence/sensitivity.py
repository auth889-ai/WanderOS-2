"""Sensitive Memory Controls — ask before surfacing, not only before recreating.

The loudest complaint about this entire product category is not that automation
is bad. It is that automation surfaces painful content *without asking*:

  Popsa (8,000 respondents): 47% actively avoid photos from certain life periods.
  Apple Memories users: "invasive & creepy" · surfaces "photos of my dead dog,
  past relationships, and places I don't want reminders of" · "cannot be
  turned off".

We already ask before *recreating* a moment. This asks before *including* one.
Same machinery, second failure mode covered.

Design constraints that matter here:
- **Never guess that something is painful.** A flag is a question, never a
  verdict, and the wording never asserts what the content means to the person.
- **Silence excludes.** If the traveller does not answer, the moment stays out.
  Getting this backwards is exactly the harm the complaints describe.
- **The decision is remembered**, so no one is asked twice about the same person
  or period.
"""
from __future__ import annotations

from typing import Any

# Included only when explicitly kept. Everything else defaults to excluded.
INCLUDE = "include"
EXCLUDE = "exclude"
PRIVATE_ONLY = "private_only"  # in the family film, never in the public reel


def _people_in(photo: dict) -> int:
    return int(photo.get("people") or 0)


def flag_sensitive(bundle: dict[str, Any], claims: list[dict]) -> list[dict]:
    """Return the moments worth asking about — as questions, never conclusions.

    We deliberately do NOT run sentiment or "sadness" detection on someone's
    private photographs. Inferring grief from an image is both unreliable and
    invasive. Instead we surface the structural signals a person can answer for
    themselves: who is in it, and when it was.
    """
    prompts: list[dict] = []

    # 1. Anything the traveller could not confirm stays out unless they say so.
    for claim in claims:
        if claim.get("status") in ("CONTRADICTED", "UNKNOWN"):
            prompts.append({
                "id": f"sensitive-{claim['id']}",
                "kind": "uncertain_moment",
                "subject": claim.get("text", "")[:120],
                "question": (f"We could not confirm \"{claim.get('text', '')[:80]}\". "
                             "Include it in the film?"),
                "default": EXCLUDE,
                "options": [INCLUDE, EXCLUDE],
            })

    # 2. Photos with people — the traveller decides who appears publicly. We ask
    #    once per photo group rather than per face; face identification would be
    #    both a privacy problem and an accuracy problem.
    with_people = [p for p in bundle.get("photos", []) if p.get("available") and _people_in(p)]
    if with_people:
        prompts.append({
            "id": "sensitive-people",
            "kind": "people",
            "subject": f"{len(with_people)} photo(s) with people in them",
            "question": ("Some photos show people. Where may they appear?"),
            "default": PRIVATE_ONLY,
            "options": [INCLUDE, PRIVATE_ONLY, EXCLUDE],
        })

    # 3. Location precision. Public output should not carry exact coordinates
    #    unless the traveller opts in — a home or hotel pin is a safety issue.
    if any(p.get("available") and p.get("gps") for p in bundle.get("photos", [])):
        prompts.append({
            "id": "sensitive-location",
            "kind": "location",
            "subject": "exact GPS coordinates in your photos",
            "question": ("Show exact locations, or only the general area, in anything "
                         "you share?"),
            "default": PRIVATE_ONLY,
            "options": [INCLUDE, PRIVATE_ONLY],
        })

    return prompts


def apply_sensitivity(prompts: list[dict], decisions: dict[str, str]) -> dict[str, Any]:
    """Fold answers in. Unanswered prompts fall back to their safe default."""
    resolved = {p["id"]: decisions.get(p["id"], p["default"]) for p in prompts}
    return {
        "decisions": resolved,
        "public_safe": [k for k, v in resolved.items() if v == INCLUDE],
        "private_only": [k for k, v in resolved.items() if v == PRIVATE_ONLY],
        "excluded": [k for k, v in resolved.items() if v == EXCLUDE],
    }


def filter_for_audience(scenes: list[dict], sensitivity: dict[str, Any],
                        audience: str = "private") -> list[dict]:
    """Two cuts from one production: the family film and the public reel.

    `audience="public"` drops anything marked private-only or excluded, which is
    how a shareable reel can exist without a second approval round.
    """
    excluded = set(sensitivity.get("excluded", []))
    private_only = set(sensitivity.get("private_only", []))
    out = []
    for scene in scenes:
        tags = set(scene.get("sensitivity_tags", []))
        if tags & excluded:
            continue
        if audience == "public" and (tags & private_only):
            continue
        out.append(scene)
    return out


def strip_precise_location(exif: dict, sensitivity: dict[str, Any]) -> dict:
    """Drop coordinates unless the traveller explicitly allowed them.

    Defaults to removal: a leaked home or hotel pin is not recoverable, and the
    film never needs coordinates to be beautiful.
    """
    if "sensitive-location" in set(sensitivity.get("public_safe", [])):
        return exif
    cleaned = dict(exif)
    for field in ("gps", "latitude", "longitude", "GPSInfo"):
        cleaned.pop(field, None)
    if cleaned.get("place"):
        # Place strings run specific -> general ("Uluwatu, Bali, Indonesia"), so
        # the LAST component is the broadest. Generalising rather than trimming
        # is the point: keeping the most precise part would defeat the control.
        cleaned["place"] = str(cleaned["place"]).split(",")[-1].strip()
    return cleaned
