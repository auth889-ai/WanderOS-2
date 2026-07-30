"""Feature 24 — Baggage Digital Twin.

A checked bag is the only thing on a trip that can be lost with no record of
what was in it. The airline asks for an itemised list with values, and the
traveller is reconstructing a suitcase from memory in a foreign airport at
midnight, four days after packing it.

So the twin is built at PACKING time, not at loss time. It composes directly
with the Smart Packing list — the contents manifest already exists; this attaches
values and a tag number to it.

**The deadlines are the feature.** Montreal Convention liability is real money,
and it evaporates on a schedule almost nobody knows:

    damage        7 days from receipt
    delay        21 days from the date the bag is placed at your disposal
    loss         21 days (a bag is generally "lost" after 21 days missing)

Miss the window and a valid claim is time-barred regardless of merit. A traveller
who reports on day 22 has lost the money entirely. This counts down in days and
says plainly when the window closes, because that is the single most valuable
thing the feature can do.

The other half is honest about what it cannot do: this does NOT track a bag's
physical location. No public API exposes that. It tracks what the traveller
knows — checked in at X, expected on belt Y, not arrived — and turns that into
deadlines and a claim.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from app.rights.passenger_rights import MONTREAL_DEADLINE_DAYS, MONTREAL_SDR

# A bag missing this long is treated as lost rather than delayed by most carriers.
PRESUMED_LOST_DAYS = 21
# Interim expenses most travellers do not know they can claim while a bag is late.
INTERIM_CLAIMABLE = (
    "essential clothing", "toiletries", "phone charger",
    "prescription replacement", "work-critical items",
)


@dataclass
class BagItem:
    name: str
    quantity: int = 1
    value: float = 0.0
    essential: bool = False       # medication, documents, work equipment
    receipt: bool = False         # a receipt makes this line far easier to claim


@dataclass
class Bag:
    tag_number: str
    checked_at: str = ""           # airport IATA
    destination: str = ""
    flight_iata: str = ""
    checked_time: datetime | None = None
    weight_kg: float | None = None
    expected_belt: str = ""
    contents: list[BagItem] = field(default_factory=list)
    status: str = "checked"        # checked | arrived | delayed | damaged | lost
    reported_time: datetime | None = None
    returned_time: datetime | None = None

    def declared_value(self) -> float:
        return round(sum(i.value * i.quantity for i in self.contents), 2)

    def essentials(self) -> list[BagItem]:
        return [i for i in self.contents if i.essential]


def from_packing_list(tag_number: str, packing: dict, *,
                      values: dict[str, float] | None = None, **kwargs) -> Bag:
    """Build a twin from the Smart Packing output.

    The contents manifest is the expensive part of a claim and it already exists
    by the time someone is at the airport — so it is captured then, not
    reconstructed from memory afterwards.
    """
    values = values or {}
    items = [
        BagItem(name=entry["name"], quantity=entry.get("quantity", 1),
                value=values.get(entry["name"], 0.0),
                essential=entry["name"] in ("medication", "prescription_copy", "laptop"))
        for entry in packing.get("checked", []) + packing.get("either", [])
    ]
    return Bag(tag_number=tag_number, contents=items, **kwargs)


def deadlines(bag: Bag, *, incident: str, event_time: datetime,
              today: date | None = None) -> dict:
    """Days remaining to report, per the Montreal Convention."""
    today = today or date.today()
    window = MONTREAL_DEADLINE_DAYS.get(incident, 21)
    closes = (event_time + timedelta(days=window)).date()
    remaining = (closes - today).days
    return {
        "incident": incident,
        "window_days": window,
        "closes_on": str(closes),
        "days_remaining": remaining,
        "expired": remaining < 0,
        "urgency": ("EXPIRED" if remaining < 0 else "critical" if remaining <= 2
                    else "soon" if remaining <= 7 else "ok"),
        "note": (
            f"A written report filed after {closes} is time-barred regardless of merit — "
            f"the carrier is not obliged to consider it."
            if remaining >= 0 else
            f"The {window}-day window closed on {closes}. A claim is likely time-barred, "
            "but file anyway if the delay in reporting was the carrier's fault."
        ),
    }


def track(bag: Bag, *, now: datetime | None = None) -> dict:
    """Current state of the bag and what it obliges the traveller to do.

    Does NOT report physical location — no public API provides it. This reports
    what is actually known, which is the difference between the bag arriving and
    it not arriving.
    """
    now = now or datetime.now()
    result: dict = {
        "tag": bag.tag_number, "status": bag.status,
        "flight": bag.flight_iata, "expected_belt": bag.expected_belt,
        "declared_value": bag.declared_value(),
        "items": len(bag.contents),
        "essentials_inside": [i.name for i in bag.essentials()],
        "actions": [],
        "location_known": False,
        "location_note": ("Physical bag location is not tracked — no public API exposes it. "
                          "This tracks what you know and what you are owed."),
    }

    if bag.essentials() and bag.status != "arrived":
        result["actions"].append({
            "urgency": "high",
            "action": f"Essential items are in this bag: {', '.join(i.name for i in bag.essentials())}",
            "why": "medication and work-critical items should travel in the cabin — "
                   "if this bag is delayed you need a replacement plan today",
        })

    if bag.status in ("delayed", "lost", "damaged"):
        event = bag.reported_time or now
        incident = "loss" if bag.status == "lost" else \
                   "damage" if bag.status == "damaged" else "delay"
        # `now` MUST be threaded through: letting deadlines() fall back to the
        # system date made a bag reported three days ago look 38 days overdue and
        # time-barred. A deadline feature that reports the wrong deadline is
        # worse than not having one.
        window = deadlines(bag, incident=incident, event_time=event, today=now.date())
        result["deadline"] = window
        result["liability_limit_sdr"] = MONTREAL_SDR["baggage"]

        if not window["expired"]:
            result["actions"].insert(0, {
                "urgency": "critical" if window["days_remaining"] <= 2 else "high",
                "action": "File a written Property Irregularity Report with the carrier",
                "why": f"{window['days_remaining']} days left; after {window['closes_on']} "
                       "the claim is time-barred",
            })
        result["actions"].append({
            "urgency": "medium",
            "action": "Keep receipts for replacement essentials",
            "why": "interim expenses are claimable while a bag is delayed: "
                   + ", ".join(INTERIM_CLAIMABLE),
        })

        if bag.status == "delayed" and bag.reported_time:
            missing_days = (now - bag.reported_time).days
            result["missing_days"] = missing_days
            if missing_days >= PRESUMED_LOST_DAYS:
                result["actions"].append({
                    "urgency": "high",
                    "action": f"Escalate from 'delayed' to 'lost' — missing {missing_days} days",
                    "why": f"after {PRESUMED_LOST_DAYS} days most carriers treat a bag as "
                           "lost, which unlocks the full liability limit rather than "
                           "interim expenses only",
                })
    return result


def claim_pack(bag: Bag, *, incident: str, event_time: datetime) -> dict:
    """The evidence bundle a baggage claim needs, and what is still missing."""
    window = deadlines(bag, incident=incident, event_time=event_time)
    with_receipts = [i for i in bag.contents if i.receipt]
    missing = [i.name for i in bag.contents if i.value > 0 and not i.receipt]
    return {
        "tag": bag.tag_number,
        "incident": incident,
        "deadline": window,
        "declared_value": bag.declared_value(),
        "liability_limit_sdr": MONTREAL_SDR["baggage"],
        "itemised": [{"name": i.name, "quantity": i.quantity, "value": i.value,
                      "receipt": i.receipt} for i in bag.contents],
        "receipts_held": len(with_receipts),
        # The useful half: what will weaken the claim, while it can still be fixed.
        "items_without_receipts": missing,
        "advice": (
            "Carriers pay depreciated value, not replacement cost, and lines without "
            "receipts are the first to be cut. Dig out what you can before filing."
            if missing else "Every valued item has a receipt — unusually strong for a claim."
        ),
    }
