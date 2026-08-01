"""Disruption cascade — what breaks NEXT.

Every flight tracker answers "what happened". Flighty does it faster than we
ever will. The question none of them answer is the one the traveller is actually
asking while standing at the gate: **which of the rest of my day is now gone?**

A trip is not a list of bookings. It is a chain of commitments where each one
depends on arriving in time for the next, and the dependency is invisible until
it fails:

    Flight  --80min late-->  Connection  --misses-->  Hotel check-in
                                                          |
                                        reception closes 23:00, and the
                                        booking is non-refundable

So this models a trip as a graph of commitments joined by edges carrying the
**slack between them**, pushes a delay through it, and reports what survives.

Three decisions that make the output trustworthy rather than dramatic:

**Slack is the only thing that decides.** A 90-minute delay with 120 minutes of
buffer breaks nothing. Reporting it as a risk because the number sounds big is
how an alerting product becomes noise the traveller mutes.

**Risk is derived from the delay's own uncertainty, not from an invented base
rate.** Given a delay estimate and how uncertain it is, a commitment's risk is
the probability that the delay exceeds its slack — a logistic on how many
uncertainty-widths of slack remain. No table of made-up percentages.

**Loss is only counted where a real amount is known.** A booking with no
recorded cost contributes nothing to the total and is listed separately, because
a confident "£340 at risk" assembled from guesses is worse than "£140 at risk,
plus 2 bookings of unknown value".
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta

# How far a commitment can slip before it is simply gone. A connection missed by
# a minute is missed; a hotel check-in has a hard closing time. Both are hard
# edges rather than gradual degradation, which is why slack — not delay size —
# is the quantity that matters.


@dataclass
class Commitment:
    """One thing that has to happen, and what it costs if it does not."""
    key: str
    label: str
    kind: str = "booking"           # flight | connection | transfer | stay | event
    starts: datetime | None = None
    # Money at stake if this is missed. None means unknown — NOT zero.
    value: float | None = None
    currency: str = "GBP"
    refundable: bool = True
    # A time after which this can no longer be honoured at all (reception
    # closing, last train, venue doors).
    hard_deadline: datetime | None = None
    # Free-text consequence that is not financial — the thing that actually
    # frightens people.
    consequence: str = ""

    def as_dict(self) -> dict:
        return {"key": self.key, "label": self.label, "kind": self.kind,
                "value": self.value, "currency": self.currency,
                "refundable": self.refundable, "consequence": self.consequence}


@dataclass
class Dependency:
    """`downstream` cannot happen unless `upstream` completed in time."""
    upstream: str
    downstream: str
    # Minutes between upstream finishing and downstream needing to start —
    # the entire safety margin.
    slack_minutes: float
    # Minutes of that slack consumed by unavoidable movement (walking a
    # terminal, clearing immigration). Slack that is already spoken for is not
    # slack.
    transfer_minutes: float = 0.0
    note: str = ""

    @property
    def usable_slack(self) -> float:
        return max(0.0, self.slack_minutes - self.transfer_minutes)


def _risk(delay_minutes: float, slack_minutes: float, uncertainty_minutes: float) -> float:
    """Probability the delay eats the slack.

    A logistic on how many uncertainty-widths of slack remain. With a precise
    delay (uncertainty near zero) this collapses to a step function, which is
    correct: a known 80-minute delay against 60 minutes of slack is not a risk,
    it is a certainty.
    """
    margin = slack_minutes - delay_minutes
    if uncertainty_minutes <= 0:
        return 0.0 if margin > 0 else 1.0
    return round(1.0 / (1.0 + math.exp(margin / uncertainty_minutes)), 3)


BAND = ((0.66, "red"), (0.33, "amber"), (0.0, "green"))

# Below this, a commitment is monitored rather than flagged. Not hidden — it
# still appears under `absorbed` with its actual probability — but a product
# that calls one-in-fifteen "at risk" trains people to ignore it, and then the
# genuine red is ignored too.
ATTENTION = 0.10


def _band(risk: float) -> str:
    return next(name for threshold, name in BAND if risk >= threshold)


@dataclass
class Graph:
    """The trip as commitments plus what depends on what."""
    commitments: dict[str, Commitment] = field(default_factory=dict)
    dependencies: list[Dependency] = field(default_factory=list)

    def add(self, commitment: Commitment) -> Graph:
        self.commitments[commitment.key] = commitment
        return self

    def depends(self, downstream: str, *, on: str, slack_minutes: float,
                transfer_minutes: float = 0.0, note: str = "") -> Graph:
        self.dependencies.append(Dependency(on, downstream, slack_minutes,
                                            transfer_minutes, note))
        return self

    def downstream_of(self, key: str) -> list[Dependency]:
        return [d for d in self.dependencies if d.upstream == key]


def propagate(graph: Graph, *, origin: str, delay_minutes: float,
              uncertainty_minutes: float = 15.0) -> dict:
    """Push a delay through the chain and report what breaks.

    Walks breadth-first from the disrupted commitment. A delay that fits inside
    an edge's slack is absorbed and stops there — that is the common case and
    reporting it as a risk is how a product becomes noise.
    """
    if origin not in graph.commitments:
        return {"error": f"unknown commitment {origin!r}",
                "known": sorted(graph.commitments)}

    # key -> (arriving late by, probability this branch is reached)
    impact: dict[str, tuple[float, float]] = {origin: (delay_minutes, 1.0)}
    chain: list[dict] = []
    absorbed: list[dict] = []
    queue = [origin]
    seen = {origin}

    while queue:
        current = queue.pop(0)
        inherited_delay, reach_probability = impact[current]

        for edge in graph.downstream_of(current):
            target = graph.commitments.get(edge.downstream)
            if target is None:
                continue

            slack = edge.usable_slack
            risk = _risk(inherited_delay, slack, uncertainty_minutes) * reach_probability

            if risk < ATTENTION:
                # The chain stops here. Say so, WITH the probability — knowing a
                # delay is contained is as useful as knowing it is not, and
                # showing the number keeps this from being a silent dismissal.
                absorbed.append({
                    "commitment": target.label,
                    "risk": round(risk, 3),
                    "why": (f"{inherited_delay:.0f} min delay against "
                            f"{slack:.0f} min of usable slack"),
                    "slack_minutes": round(slack, 1),
                })
                continue

            # What survives the edge is the overrun, not the whole delay.
            overrun = max(0.0, inherited_delay - slack)
            breach = None
            if target.hard_deadline and target.starts:
                shifted = target.starts + timedelta(minutes=overrun)
                if shifted > target.hard_deadline:
                    breach = (f"arrives {(shifted - target.hard_deadline).seconds // 60} "
                              f"min after the last possible time")

            chain.append({
                "commitment": target.label,
                "key": target.key,
                "kind": target.kind,
                "risk": round(risk, 3),
                "band": _band(risk),
                "late_by_minutes": round(overrun, 1),
                "slack_minutes": round(slack, 1),
                "because": edge.note or f"depends on {graph.commitments[current].label}",
                "hard_deadline_breached": breach,
                "consequence": target.consequence,
                "value_at_risk": target.value if not target.refundable else None,
                "currency": target.currency,
                "refundable": target.refundable,
            })

            if target.key not in seen:
                seen.add(target.key)
                impact[target.key] = (overrun, risk)
                queue.append(target.key)

    # Expected loss over non-refundable commitments with a KNOWN value.
    known = [c for c in chain if c["value_at_risk"] is not None]
    unknown = [c["commitment"] for c in chain
               if c["value_at_risk"] is None and not c["refundable"]]
    expected = round(sum(c["value_at_risk"] * c["risk"] for c in known), 2)

    chain.sort(key=lambda c: -c["risk"])
    return {
        "origin": graph.commitments[origin].label,
        "delay_minutes": delay_minutes,
        "at_risk": chain,
        "absorbed": absorbed,
        "worst_band": chain[0]["band"] if chain else "green",
        "expected_loss": expected,
        "currency": known[0]["currency"] if known else "GBP",
        "unpriced_at_risk": unknown,
        "headline": _headline(graph.commitments[origin], delay_minutes, chain,
                              expected, known),
        "basis": ("Risk is the probability the delay exceeds the slack, given how "
                  "uncertain the delay is — not a base rate. Loss counts only "
                  "non-refundable bookings whose value is actually recorded."),
    }


def _headline(origin: Commitment, delay: float, chain: list[dict],
              expected: float, known: list[dict]) -> str:
    """One sentence a person can act on."""
    if not chain:
        return (f"{origin.label} is {delay:.0f} min late, and nothing else in your "
                f"trip depends on it closely enough to break.")

    worst = chain[0]
    money = (f" About {worst['currency']}{expected:.0f} is at risk."
             if known and expected >= 1 else "")
    breach = f" {worst['hard_deadline_breached'].capitalize()}." \
        if worst["hard_deadline_breached"] else ""
    return (f"{origin.label} is {delay:.0f} min late. The most exposed thing next is "
            f"{worst['commitment']} at {worst['risk']:.0%} risk.{breach}{money}")


# --- Building the graph from what the twin already knows ------------------

def from_twin(twin) -> Graph:
    """Derive the dependency chain from recorded facts.

    Only commitments the twin actually holds become nodes. A trip with no hotel
    gets no hotel node rather than a placeholder, because a cascade built on
    assumed bookings predicts the failure of things that do not exist.
    """
    from app.journey import twin as T

    graph = Graph()
    flight = twin.get(T.FLIGHT) or {}

    if flight.get("flight_iata") or flight.get("scheduled_arrival"):
        arrival = None
        if flight.get("scheduled_arrival"):
            try:
                arrival = datetime.fromisoformat(flight["scheduled_arrival"])
            except ValueError:
                pass
        graph.add(Commitment(
            key="flight", kind="flight",
            label=f"Flight {flight.get('flight_iata', '')}".strip(),
            starts=arrival))

    destination = twin.get(T.DESTINATION, "")
    if destination and "flight" in graph.commitments:
        graph.add(Commitment(key="onward", kind="transfer",
                             label=f"Onward transfer to {destination}"))
        graph.depends("onward", on="flight", slack_minutes=60,
                      transfer_minutes=35,
                      note="baggage reclaim and immigration before the transfer")
    return graph
