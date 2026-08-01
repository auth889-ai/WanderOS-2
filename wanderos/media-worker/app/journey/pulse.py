"""Journey Pulse — the board. What the traveller sees first.

The strategy review scores this product's UI 2.5/10 and names the reason: there
is no Guardian screen, and `/try` shows raw JSON. Raw JSON is proof for a judge
and an insult to a traveller.

So this is the state behind a **living journey ribbon** —

    Home -> Airport -> Flight -> Transfer -> Hotel -> Event

— where every node carries one of four states:

    green   safe
    amber   risk emerging
    red     action needed
    purple  Guardian is already protecting it

Purple is the one that matters and the one no competitor has. A tracker can
show red. Only a system that has *taken an action* can show purple, and the node
records which action, so the colour is a claim with evidence rather than
decoration.

Two things adopted from studying Flighty, which does this better than anyone:

**Connections are rated against a real minimum connection time**, not an
arbitrary buffer. Flighty grades Risky / Tight / Normal / Relaxed using official
MCT — terminals, immigration, boarding. Slack alone would call a 40-minute
international transfer comfortable.

**The board must survive losing the network.** Flighty assumes every traveller
disappears at takeoff, so it precomputes and stores locally. Every node here
carries `stale_after` and the whole board serialises, so a phone in airplane
mode over the Atlantic still shows something true rather than a spinner.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from app.journey import cascade as C

GREEN, AMBER, RED, PURPLE = "green", "amber", "red", "purple"

# Minimum connection time floors, in minutes. These are the industry's own
# published shapes, not a guess: a domestic-to-domestic transfer at a single
# terminal is a genuinely different animal from an international one requiring
# immigration and re-check.
#
# Where a carrier or airport publishes its own MCT it should override this;
# these are the fallback and are labelled as such in the output.
MCT_FLOOR = {
    ("domestic", "domestic"): 40,
    ("domestic", "international"): 60,
    ("international", "domestic"): 75,   # immigration + baggage reclaim + re-check
    ("international", "international"): 90,
}

# How the ratio of available time to required MCT reads to a traveller.
CONNECTION_GRADE = (
    (2.0, "relaxed", GREEN),
    (1.35, "normal", GREEN),
    (1.0, "tight", AMBER),
    (0.0, "risky", RED),
)


def minimum_connection(from_kind: str = "international",
                       to_kind: str = "international", *,
                       terminal_change: bool = False,
                       published_mct: int | None = None) -> dict:
    """How long this transfer actually needs.

    A published MCT from the airport or carrier always wins — it accounts for
    that specific terminal's geometry in a way no general rule can.
    """
    if published_mct is not None:
        return {"minutes": published_mct, "source": "published",
                "basis": "airport or carrier published minimum connection time"}

    floor = MCT_FLOOR.get((from_kind, to_kind), 90)
    if terminal_change:
        floor += 20
    return {"minutes": floor, "source": "category_floor",
            "basis": (f"{from_kind}->{to_kind} floor"
                      + (" plus terminal change" if terminal_change else "")),
            "caveat": "no published MCT for this airport; category floor used"}


def grade_connection(available_minutes: float, required: dict) -> dict:
    """Relaxed / normal / tight / risky — against the real requirement."""
    need = max(1, required["minutes"])
    ratio = available_minutes / need
    label, band = next((l, b) for threshold, l, b in CONNECTION_GRADE
                       if ratio >= threshold)
    return {
        "grade": label, "band": band, "ratio": round(ratio, 2),
        "available_minutes": round(available_minutes),
        "required_minutes": need,
        "spare_minutes": round(available_minutes - need),
        "requirement_source": required["source"],
        "basis": required["basis"],
        "caveat": required.get("caveat", ""),
    }


@dataclass
class Node:
    """One stop on the ribbon."""
    key: str
    label: str
    kind: str = "booking"
    at: datetime | None = None
    band: str = GREEN
    detail: str = ""
    # What Guardian DID. Its presence is what makes a node purple, so an empty
    # list can never be rendered as protected.
    protections: list[dict] = field(default_factory=list)
    risk: float = 0.0
    # After this the value should not be trusted without a refresh — the field
    # that makes an offline board honest instead of merely available.
    stale_after: datetime | None = None
    actions: list[dict] = field(default_factory=list)

    @property
    def state(self) -> str:
        """Protection outranks risk. A red that Guardian has already acted on
        is purple, because 'action needed' is false once the action is taken."""
        return PURPLE if self.protections else self.band

    def as_dict(self, *, now: datetime | None = None) -> dict:
        now = now or datetime.now(timezone.utc)
        stale = bool(self.stale_after and now > self.stale_after)
        return {
            "key": self.key, "label": self.label, "kind": self.kind,
            "at": self.at.isoformat() if self.at else None,
            "state": self.state, "band": self.band, "detail": self.detail,
            "risk": round(self.risk, 3),
            "protections": self.protections,
            "protected": bool(self.protections),
            "actions": self.actions,
            "stale": stale,
            "stale_after": self.stale_after.isoformat() if self.stale_after else None,
            # An offline board that hides its own staleness is worse than one
            # that admits it.
            "confidence_note": ("shown from cache; may be out of date" if stale
                                else ""),
        }


WORST_FIRST = {RED: 0, AMBER: 1, PURPLE: 2, GREEN: 3}


def build(twin, *, graph: C.Graph | None = None, disruption: dict | None = None,
          now: datetime | None = None) -> dict:
    """The whole board, from what the twin knows.

    Nodes exist only for commitments actually recorded. A trip with no hotel
    shows no hotel node — a ribbon padded with placeholders is a mock-up, and
    the traveller cannot tell which parts are real.
    """
    from app.journey import twin as T

    now = now or datetime.now(timezone.utc)
    graph = graph if graph is not None else C.from_twin(twin)
    nodes: list[Node] = []

    destination = twin.get(T.DESTINATION, "")
    start = twin.get(T.START)

    # --- Readiness comes first because it is actionable before you leave ---
    readiness = twin.get("readiness") or {}
    blocking = [f for f in readiness.get("findings", [])
                if f.get("severity") == "blocking"]
    if readiness:
        nodes.append(Node(
            key="readiness", label="Documents & readiness", kind="prep",
            band=RED if blocking else GREEN,
            detail=(f"{len(blocking)} blocking issue(s)" if blocking
                    else "Passport and documents check out"),
            actions=[{"label": "Fix now", "route": "/wallet"}] if blocking else []))

    # --- The flight ---
    flight = twin.get(T.FLIGHT) or {}
    if flight:
        delay = flight.get("delay_minutes") or 0
        arrival = None
        if flight.get("scheduled_arrival"):
            try:
                arrival = datetime.fromisoformat(flight["scheduled_arrival"])
            except ValueError:
                pass
        nodes.append(Node(
            key="flight", label=f"Flight {flight.get('flight_iata', '')}".strip(),
            kind="flight", at=arrival,
            band=RED if delay >= 60 else AMBER if delay >= 20 else GREEN,
            detail=(f"{delay:.0f} min late" if delay else "On time"),
            # Flight status ages fast. Half an hour is already generous.
            stale_after=now + timedelta(minutes=30),
            actions=[{"label": "See ways forward", "route": "/rescue"}]
                    if delay >= 20 else []))

    # --- Weather, which decides whether a plan is walkable ---
    weather = twin.get(T.WEATHER) or {}
    if weather.get("usable") is not False and weather:
        rain = weather.get("rain_expected")
        nodes.append(Node(
            key="weather", label=f"Weather in {destination}" if destination else "Weather",
            kind="condition",
            at=datetime.combine(start, datetime.min.time()) if start else None,
            band=AMBER if rain else GREEN,
            detail=(f"{weather.get('min_temp_c')}–{weather.get('max_temp_c')}°C"
                    + (", rain expected" if rain else "")),
            # A forecast is measured; a climate estimate is not. The distinction
            # the weather module makes survives onto the board.
            stale_after=now + timedelta(hours=6 if weather.get("kind") == "forecast" else 72)))

    # --- Everything downstream of the disruption ---
    if disruption and disruption.get("at_risk"):
        for item in disruption["at_risk"]:
            nodes.append(Node(
                key=item["key"], label=item["commitment"], kind=item["kind"],
                band=item["band"], risk=item["risk"],
                detail=(item.get("hard_deadline_breached")
                        or f"{item['risk']:.0%} risk — {item['because']}"),
                stale_after=now + timedelta(minutes=30),
                actions=[{"label": "Protect this", "route": "/rescue"}]))
    elif graph.commitments:
        for key, commitment in graph.commitments.items():
            if key == "flight":
                continue
            nodes.append(Node(key=key, label=commitment.label,
                              kind=commitment.kind, at=commitment.starts,
                              band=GREEN, detail="No risk detected"))

    # --- Entitlement is money owed, which is never "just information" ---
    entitlement = twin.get(T.ENTITLEMENT) or {}
    if entitlement.get("eligible"):
        amount = entitlement.get("amount")
        nodes.append(Node(
            key="rights", label="Compensation owed to you", kind="rights",
            band=AMBER,
            detail=(f"{entitlement.get('currency', '')}{amount} under "
                    f"{entitlement.get('rule', 'passenger rights')}"),
            actions=[{"label": "Build the claim", "route": "/wallet"}]))

    board = [n.as_dict(now=now) for n in nodes]
    worst = min((n["state"] for n in board), key=lambda s: WORST_FIRST[s],
                default=GREEN)

    return {
        "trip_id": twin.trip_id,
        "destination": destination,
        "generated_at": now.isoformat(),
        "overall": worst,
        "headline": _speak(board, destination),
        "nodes": board,
        "legend": {
            GREEN: "safe", AMBER: "risk emerging", RED: "action needed",
            PURPLE: "Guardian is already protecting this",
        },
        # The board is the offline artefact. Everything needed to render it is
        # in this payload — no second call, no live lookup.
        "offline_ready": True,
        "principle": ("The journey speaks first. A chat box that waits to be asked "
                      "makes the traveller do the noticing, which is the one job "
                      "they cannot do from inside the airport."),
    }


def _speak(board: list[dict], destination: str) -> str:
    """The journey says one true sentence about itself.

    Not a chat prompt. The traveller should not have to ask whether their trip
    is intact.
    """
    red = [n for n in board if n["state"] == RED]
    amber = [n for n in board if n["state"] == AMBER]
    protected = [n for n in board if n["state"] == PURPLE]

    if not board:
        return "Nothing is known about this trip yet."
    if red:
        return (f"{red[0]['label']} needs you: {red[0]['detail']}."
                + (f" {len(red) - 1} other thing(s) also need action."
                   if len(red) > 1 else ""))
    if amber:
        # Not .lower() — that mangles flight codes and place names into
        # "flight ek582 in london".
        return (f"Your trip is holding together. One thing to watch: "
                f"{amber[0]['label']} — {amber[0]['detail']}.")
    if protected:
        return (f"Your trip is safe. Guardian is protecting "
                f"{len(protected)} part(s) of it.")
    return (f"Your trip{' to ' + destination if destination else ''} is healthy. "
            f"Nothing needs you right now.")


def protect(board: dict, node_key: str, *, action: str, by: str,
            reversible_until: datetime | None = None) -> dict:
    """Record that Guardian acted — which is what turns a node purple.

    Deliberately requires the action to be named. A purple node without a
    recorded action would be the product claiming credit for nothing, and this
    whole system's argument is that a claim without a basis is worthless.
    """
    for node in board.get("nodes", []):
        if node["key"] == node_key:
            node["protections"].append({
                "action": action, "by": by,
                "at": datetime.now(timezone.utc).isoformat(),
                "reversible_until": (reversible_until.isoformat()
                                     if reversible_until else None),
            })
            node["protected"] = True
            node["state"] = PURPLE
            break
    board["overall"] = min((n["state"] for n in board.get("nodes", [])),
                           key=lambda s: WORST_FIRST[s], default=GREEN)
    board["headline"] = _speak(board.get("nodes", []), board.get("destination", ""))
    return board
