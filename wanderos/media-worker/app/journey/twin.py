"""The Journey Twin — one shared state every feature reads from and writes to.

This project accumulated thirty-odd capable modules that did not talk to each
other. An audit found fourteen with **zero callers**: the packing list never saw
the weather that was already fetched, the rescue engine never saw the mobility
limits the fairness engine knew about, and the film never saw the route the
timeline had built. Each module was correct and the product was not, because a
capability nothing can reach is not a capability.

The cause was architectural, not effort. Features were written as functions
taking their own arguments, so connecting any two meant a caller who happened to
know about both. With thirty modules that is 435 possible pairs, and nobody
writes 435 callers.

A twin fixes that with one rule:

    **Features read the trip and write facts back to it. They never call
    each other.**

Adding a feature becomes O(1) — it reads what it needs and contributes what it
learns — instead of O(n) integrations. The packing list reads `weather` without
knowing who fetched it. The rescue engine reads `mobility` without knowing the
fairness negotiator recorded it.

Two properties this enforces that are hard to retrofit:

**Provenance travels with the fact.** Every value carries who produced it, when,
and how confident they were. The whole product argues that a number without a
basis is untrustworthy; storing bare values in shared state would have
contradicted that at the centre.

**Later, better-sourced facts win — and losers are kept.** A traveller's
correction outranks an inference. An official source outranks a venue's claim.
The superseded value stays visible so a wrong answer can be traced rather than
silently overwritten.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any

# Source strength, weakest first. The same ladder the accessibility layer uses,
# lifted here because it turned out to be the right ordering for every fact.
SOURCE_RANK = {
    "assumed": 0,        # a default we picked
    "inferred": 1,       # derived by a model or heuristic
    "third_party": 2,    # a vendor API
    "measured": 3,       # computed from real data (EXIF, routing, forecast)
    "traveller": 4,      # the person said so
    "official": 5,       # a regulator, carrier, or government source
}


@dataclass
class Fact:
    """A value plus everything needed to judge it."""
    value: Any
    source: str = "inferred"
    by: str = ""                     # which module produced it
    at: str = ""
    confidence: float = 1.0
    note: str = ""

    def __post_init__(self):
        if not self.at:
            self.at = datetime.now(timezone.utc).isoformat()
        if self.source not in SOURCE_RANK:
            raise ValueError(f"unknown source {self.source!r}")

    @property
    def rank(self) -> int:
        return SOURCE_RANK[self.source]

    def as_dict(self) -> dict:
        return {**self.__dict__, "rank": self.rank}


@dataclass
class Twin:
    """Everything known about one trip.

    Deliberately a plain container. Logic lives in the feature modules; putting
    it here would recreate the coupling this exists to remove.
    """
    trip_id: str
    facts: dict[str, Fact] = field(default_factory=dict)
    superseded: list[dict] = field(default_factory=list)

    # --- writing ---

    def record(self, key: str, value: Any, *, source: str = "inferred",
               by: str = "", confidence: float = 1.0, note: str = "") -> bool:
        """Write a fact. Returns False if an existing fact outranks this one.

        Refusing a weaker write is the point. Without it, whichever module ran
        last would win, and a venue's marketing claim could silently overwrite a
        traveller's first-hand correction.
        """
        incoming = Fact(value, source, by, "", confidence, note)
        existing = self.facts.get(key)

        if existing is not None and existing.rank > incoming.rank:
            self.superseded.append({"key": key, "rejected": incoming.as_dict(),
                                    "kept": existing.as_dict(),
                                    "why": f"{existing.source} outranks {incoming.source}"})
            return False

        if existing is not None:
            self.superseded.append({"key": key, "replaced": existing.as_dict(),
                                    "by": incoming.as_dict(),
                                    "why": f"{incoming.source} >= {existing.source}"})
        self.facts[key] = incoming
        return True

    # --- reading ---

    def get(self, key: str, default: Any = None) -> Any:
        fact = self.facts.get(key)
        return fact.value if fact else default

    def fact(self, key: str) -> Fact | None:
        return self.facts.get(key)

    def known(self, *keys: str) -> bool:
        """True only if every key has a fact. Features use this to decide
        whether they can run at all, rather than guessing at missing input."""
        return all(k in self.facts for k in keys)

    def missing(self, *keys: str) -> list[str]:
        return [k for k in keys if k not in self.facts]

    def trusted(self, key: str, *, at_least: str = "measured") -> bool:
        fact = self.facts.get(key)
        return bool(fact and fact.rank >= SOURCE_RANK[at_least])

    # --- inspection ---

    def provenance(self) -> dict:
        """Where everything came from — the audit view."""
        return {k: {"source": f.source, "by": f.by, "at": f.at,
                    "confidence": f.confidence} for k, f in self.facts.items()}

    def as_dict(self) -> dict:
        return {"trip_id": self.trip_id,
                "facts": {k: f.as_dict() for k, f in self.facts.items()},
                "superseded": self.superseded}

    def to_json(self) -> str:
        return json.dumps(self.as_dict(), default=str, sort_keys=True)


# --- The keys features agree on -------------------------------------------
#
# A shared vocabulary, so two modules cannot disagree about what "destination"
# is called. Deliberately flat: nesting invites each feature to invent its own
# shape underneath.

DESTINATION = "destination"          # str, place name
COUNTRY = "country"                  # ISO-2
START = "start_date"                 # date
END = "end_date"                     # date
TRAVELLERS = "travellers"            # int
WEATHER = "weather"                  # WeatherWindow.as_dict()
MOBILITY = "mobility"                # low | moderate | high
SENSORY_TOLERANCE = "sensory_tolerance"
BUDGET_TOTAL = "budget_total"
TIMELINE = "timeline"                # evidence.timeline output
JOURNEY = "journey"                  # evidence.journey output
PHOTOS = "photos"
FLIGHT = "flight"                    # flight_status.as_dict()
DISRUPTION = "disruption"            # recovery plan
ENTITLEMENT = "entitlement"          # rights assessment
DOCUMENTS = "documents"
PACKING = "packing"
TRUE_COST = "true_cost"
CORRECTIONS = "corrections"


def seed(trip_id: str, *, destination: str = "", country: str = "",
         start: date | None = None, end: date | None = None,
         travellers: int = 1, mobility: str = "moderate") -> Twin:
    """A twin with what the traveller told us directly.

    Everything here is `traveller` sourced, which is why later inference cannot
    quietly overwrite it.
    """
    twin = Twin(trip_id=trip_id)
    for key, value in ((DESTINATION, destination), (COUNTRY, country),
                       (START, start), (END, end)):
        if value:
            twin.record(key, value, source="traveller", by="intake")
    twin.record(TRAVELLERS, travellers, source="traveller", by="intake")
    twin.record(MOBILITY, mobility, source="traveller", by="intake")
    return twin
