"""The truth model — WanderOS's category-defining layer.

Every statement the film might make is a *claim* with an explicit status, and
generation is gated on that status. The system may not recreate a moment it
cannot prove unless the traveler personally confirms it happened.

    VERIFIED       media directly attests to it        -> use the real media
    INFERRED       plausible, not confirmed            -> ASK the traveler
    USER_CONFIRMED traveler said it happened           -> recreate, disclosed
    SYNTHETIC      no real-world basis, story only     -> recreate, disclosed
    CONTRADICTED   sources disagree                    -> stop, ask
    UNKNOWN        cannot responsibly decide           -> omit or title card

Only USER_CONFIRMED and SYNTHETIC may be visually recreated, and both are
labeled on screen. INFERRED is the interesting one: it is where a normal AI app
would quietly invent your memory, and where this one stops and asks.

Claude does the classification because weighing "the itinerary says sunset but no
photo exists" against "the voice note mentions it" is judgement, not a rule. When
Claude is unavailable the deterministic fallback marks everything it cannot prove
as INFERRED — the cautious direction, never a false VERIFIED.
"""
from __future__ import annotations

from typing import Any

from app.repo.claude import ClaudeUnavailable, complete, describe

GENERATABLE = {"USER_CONFIRMED", "SYNTHETIC"}
NEEDS_CONSENT = {"INFERRED", "CONTRADICTED"}

CLAIMS_SCHEMA = {
    "type": "object",
    "required": ["claims"],
    "properties": {
        "claims": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id", "text", "status", "confidence", "evidence", "question"],
                "properties": {
                    "id": {"type": "string"},
                    "text": {"type": "string"},
                    "status": {"type": "string", "enum": [
                        "VERIFIED", "INFERRED", "USER_CONFIRMED",
                        "SYNTHETIC", "CONTRADICTED", "UNKNOWN"]},
                    "confidence": {"type": "number"},
                    "evidence": {"type": "array", "items": {"type": "string"}},
                    "question": {"type": "string"},
                    "day": {"type": ["integer", "null"]},
                },
            },
        }
    },
}

PROMPT = """You are the Experience Director for a travel memory film. Your job is
to decide what this trip's evidence can and cannot prove, so the film never
invents a memory the traveler did not live.

You are given three independent views of one trip:
- DOCUMENTS (itinerary/bookings): what was PLANNED. A plan is not proof it happened.
- VOICE NOTES: what the traveler REMEMBERS saying happened.
- PHOTOS (labels + timestamps): what was PHOTOGRAPHED. This is the strongest evidence.

Produce one claim per meaningful moment. Assign each a status:
- VERIFIED: photo evidence directly supports it.
- INFERRED: planned or plausible, but NOT confirmed by photos. This is the default
  for anything the itinerary lists that no photo shows.
- CONTRADICTED: sources disagree (e.g. itinerary says one place, photos show another).
- UNKNOWN: you genuinely cannot tell.
Never output USER_CONFIRMED or SYNTHETIC — only the traveler can grant those.

For every INFERRED or CONTRADICTED claim, write `question` as a direct, neutral
question to the traveler. State what the evidence does and does not show. Never
assert the moment happened. Good: "Your itinerary lists a sunset visit at Uluwatu,
but no uploaded photo shows it. Did you go?" Bad: "Tell me about the sunset you watched."
For VERIFIED claims leave `question` as an empty string.

`evidence` lists the source keys that informed the claim. `confidence` is 0-1.

TRIP EVIDENCE:
{evidence}
"""


def _brief(bundle: dict[str, Any]) -> str:
    parts: list[str] = []
    for doc in bundle.get("documents", []):
        if doc.get("available"):
            parts.append(f"[DOCUMENT {doc['key']}]\n{doc.get('text', '')[:4000]}")
    for note in bundle.get("voice", []):
        if note.get("available"):
            parts.append(f"[VOICE {note['key']}]\n{note.get('text', '')[:3000]}")
    photos = [p for p in bundle.get("photos", []) if p.get("available")]
    if photos:
        lines = [
            f"- {p['key']}: {', '.join(l['name'] for l in p.get('labels', [])[:8])}"
            f" | people={p.get('people', 0)}"
            for p in photos[:60]
        ]
        parts.append("[PHOTOS]\n" + "\n".join(lines))
    if bundle.get("degraded"):
        parts.append("[MISSING SOURCES — do not treat as evidence of absence]\n"
                     + "\n".join(f"- {d['key']} ({d['kind']}): {d['reason']}"
                                 for d in bundle["degraded"][:15]))
    return "\n\n".join(parts) or "(no evidence could be extracted)"


def classify(bundle: dict[str, Any], timeline: dict | None = None) -> dict[str, Any]:
    """Turn extracted evidence into a status-tagged claim set."""
    evidence = _brief(bundle)
    if timeline:
        evidence += f"\n\n[TIMELINE]\n{str(timeline)[:2500]}"
    try:
        result = complete(PROMPT.format(evidence=evidence), schema=CLAIMS_SCHEMA, max_tokens=4096)
        claims = result.get("claims", [])
        for claim in claims:
            # The model may not grant these no matter what the prompt says.
            if claim.get("status") in GENERATABLE:
                claim["status"] = "INFERRED"
        return {"claims": claims, "classifier": describe(), "degraded": False}
    except (ClaudeUnavailable, Exception) as exc:
        return _fallback(bundle, reason=f"{type(exc).__name__}: {exc}"[:180])


def _fallback(bundle: dict[str, Any], *, reason: str) -> dict[str, Any]:
    """No reasoner available: photographed moments are VERIFIED, everything the
    documents merely planned is INFERRED. Cautious by construction — this can
    never promote something to VERIFIED without a photo."""
    claims: list[dict[str, Any]] = []
    for photo in bundle.get("photos", []):
        if not photo.get("available"):
            continue
        labels = ", ".join(l["name"] for l in photo.get("labels", [])[:4])
        claims.append({
            "id": f"photo-{photo['key']}", "text": f"Photographed: {labels or 'moment'}",
            "status": "VERIFIED", "confidence": 0.9, "evidence": [photo["key"]],
            "question": "", "day": None,
        })
    for doc in bundle.get("documents", []):
        if not doc.get("available"):
            continue
        for i, line in enumerate(doc.get("lines", [])[:12]):
            if len(line.strip()) < 8:
                continue
            claims.append({
                "id": f"plan-{doc['key']}-{i}", "text": f"Itinerary lists: {line.strip()[:120]}",
                "status": "INFERRED", "confidence": 0.4, "evidence": [doc["key"]],
                "question": (f"Your itinerary lists \"{line.strip()[:80]}\", but the uploaded "
                             "photos do not confirm it happened. Did you go?"),
                "day": None,
            })
    return {"claims": claims, "degraded": True,
            "classifier": f"deterministic rules (no Claude: {reason})"}


def consent_questions(claims: list[dict]) -> list[dict]:
    """The only claims the traveler is asked about — never the verified ones."""
    return [
        {"id": c["id"], "text": c["text"], "question": c["question"],
         "status": c["status"], "evidence": c.get("evidence", [])}
        for c in claims if c.get("status") in NEEDS_CONSENT and c.get("question")
    ]


def apply_consent(claims: list[dict], decisions: dict[str, str]) -> list[dict]:
    """Fold traveler answers in. ``decisions``: claim id -> confirmed|denied|unsure.

    Only the traveler can produce USER_CONFIRMED — that is the whole point of the
    gate, so this is the single place the status may be promoted.
    """
    out = []
    for claim in claims:
        decision = decisions.get(claim["id"])
        updated = dict(claim)
        if decision == "confirmed" and claim["status"] in NEEDS_CONSENT:
            updated["status"] = "USER_CONFIRMED"
            updated["confirmed_by_user"] = True
        elif decision == "denied":
            updated["status"] = "UNKNOWN"
            updated["excluded"] = True
        elif decision == "unsure":
            updated["status"] = "UNKNOWN"
        out.append(updated)
    return out


def may_generate(claim: dict) -> bool:
    """The gate. A scene may only be visually recreated from these statuses."""
    return claim.get("status") in GENERATABLE and not claim.get("excluded")


def disclosure_required(claim: dict) -> bool:
    """Anything not directly photographed carries an on-screen label."""
    return claim.get("status") != "VERIFIED"
