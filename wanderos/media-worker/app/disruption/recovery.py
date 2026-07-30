"""Feature 21 — Disruption Recovery Autopilot.

When a flight goes wrong, the traveller is standing in a queue of two hundred
people, on a phone that is about to die, being told to "check the app". Three
different things need doing at once and only one of them is obvious:

  1. **Get where you are going.** The queue is for this.
  2. **Stop the knock-on losses.** The airport transfer, the non-refundable
     tour tomorrow morning, the hotel night you will not use. Every hour this
     goes unhandled, more of it becomes unrecoverable.
  3. **Preserve the evidence.** The departure board, the delay notice, the
     receipts. In four weeks these decide whether a claim succeeds, and by then
     they are gone.

Nobody does 2 and 3 while standing in the queue, which is exactly why they are
worth automating. This composes the pieces already built rather than
reimplementing them: the Passenger Rights engine assesses entitlement, the
Budget Autopilot flags at-risk spend, and the Claim Capsule seals evidence while
it still exists.

The ranking rule: **actions that expire soonest come first**, not the ones that
are worth the most. A EUR 600 claim can be filed next month; a EUR 90 tour can
only be moved in the next two hours.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from app.disruption.flight_status import FlightStatus

# A connection needs this much slack, or it is at risk. Below it, assume missed.
MIN_CONNECTION_MIN = {"domestic": 45, "international": 90}


@dataclass
class Booking:
    """Anything downstream of the flight that a delay can damage."""
    name: str
    kind: str                  # connection | hotel | transfer | tour | rental
    starts: datetime
    refundable: bool = False
    amount: float = 0.0
    cancel_deadline: datetime | None = None
    reference: str = ""
    international: bool = False


@dataclass
class Action:
    urgency: str               # now | today | this_week | later
    title: str
    why: str
    expires: datetime | None = None
    value_at_stake: float = 0.0
    automated: bool = False

    def as_dict(self) -> dict:
        return {**self.__dict__,
                "expires": self.expires.isoformat() if self.expires else None}


_URGENCY_ORDER = {"now": 0, "today": 1, "this_week": 2, "later": 3}


def assess_impact(flight: FlightStatus, bookings: list[Booking],
                  *, now: datetime | None = None) -> dict:
    """What this disruption breaks downstream, and what can still be saved."""
    now = now or datetime.now()
    delay = timedelta(hours=flight.delay_hours())
    cancelled = flight.status == "cancelled"
    arrival = flight.actual_arrival or (
        (flight.scheduled_arrival + delay) if flight.scheduled_arrival else None)

    broken, at_risk, safe = [], [], []
    for booking in bookings:
        if arrival is None:
            safe.append(booking)
            continue
        if cancelled:
            broken.append((booking, "the flight was cancelled"))
            continue

        slack_min = (booking.starts - arrival).total_seconds() / 60
        if booking.kind == "connection":
            needed = MIN_CONNECTION_MIN["international" if booking.international else "domestic"]
            if slack_min < needed:
                broken.append((booking,
                               f"only {slack_min:.0f} min after you land; this connection "
                               f"needs {needed} min"))
                continue
        if slack_min < 0:
            broken.append((booking, f"starts {abs(slack_min):.0f} min before you now land"))
        elif slack_min < 120:
            at_risk.append((booking, f"only {slack_min:.0f} min after you land"))
        else:
            safe.append(booking)

    exposure = sum(b.amount for b, _ in broken if not b.refundable)
    return {
        "flight": flight.flight_iata,
        "status": flight.status,
        "delay_hours": flight.delay_hours(),
        "new_arrival": arrival.isoformat() if arrival else None,
        "broken": [{"name": b.name, "kind": b.kind, "amount": b.amount,
                    "refundable": b.refundable, "why": why} for b, why in broken],
        "at_risk": [{"name": b.name, "kind": b.kind, "amount": b.amount,
                     "refundable": b.refundable, "why": why} for b, why in at_risk],
        "safe": [b.name for b in safe],
        # Non-refundable money attached to something that can no longer happen.
        "unrecoverable_exposure": round(exposure, 2),
    }


def recovery_plan(flight: FlightStatus, bookings: list[Booking],
                  *, now: datetime | None = None,
                  entitlement: dict | None = None) -> dict:
    """Everything to do, soonest-expiring first."""
    now = now or datetime.now()
    impact = assess_impact(flight, bookings, now=now)
    actions: list[Action] = []

    # 1. Evidence first. It is free, it takes a minute, and it is the only item
    #    here that becomes impossible rather than merely harder with time.
    actions.append(Action(
        "now", "Photograph the departure board and any delay notice",
        "In four weeks this is what decides a claim, and by then the board has "
        "changed and the email is buried. Sealing it now costs nothing.",
        expires=now + timedelta(hours=6), automated=True))

    # 2. Bookings that can still be moved, ordered by their own deadline.
    for entry in impact["broken"] + impact["at_risk"]:
        booking = next(b for b in bookings if b.name == entry["name"])
        if booking.refundable and booking.cancel_deadline:
            hours = (booking.cancel_deadline - now).total_seconds() / 3600
            actions.append(Action(
                "now" if hours < 6 else "today",
                f"Cancel or move '{booking.name}' ({booking.kind})",
                f"refundable until {booking.cancel_deadline:%d %b %H:%M} — "
                f"{hours:.0f}h left. After that the {booking.amount:.0f} is gone.",
                expires=booking.cancel_deadline, value_at_stake=booking.amount))
        elif not booking.refundable and booking.amount > 0:
            actions.append(Action(
                "today", f"Ask the operator to move '{booking.name}'",
                "Non-refundable, so there is nothing to reclaim — but operators will "
                "often reschedule if asked before the slot passes, and never after.",
                value_at_stake=booking.amount))

    # 3. Rebooking, when the flight itself failed.
    if flight.status == "cancelled" or flight.delay_hours() >= 5:
        actions.append(Action(
            "now", "Choose re-routing or a refund",
            "A cancellation or a 5h+ delay gives you the choice, and taking a "
            "replacement flight does not forfeit compensation. Airlines rarely "
            "volunteer that.",
            value_at_stake=0.0))

    # 4. Entitlement, last — worth the most, expires the latest.
    if entitlement and entitlement.get("headline_amount"):
        actions.append(Action(
            "this_week", f"File for {entitlement['headline_amount']} compensation",
            f"{entitlement['claimable_count']} entitlement(s) apply. Deadlines run to "
            "years, so this is the one thing that can safely wait until you are home.",
            value_at_stake=float(entitlement["headline_amount"])))

    actions.sort(key=lambda a: (_URGENCY_ORDER[a.urgency],
                                a.expires or (now + timedelta(days=365))))
    return {
        "impact": impact,
        "actions": [a.as_dict() for a in actions],
        "do_now": [a.title for a in actions if a.urgency == "now"],
        "total_at_stake": round(sum(a.value_at_stake for a in actions), 2),
        # Stated because it is the counterintuitive part: the money is not the
        # urgent bit.
        "principle": ("Ordered by what expires soonest, not by what is worth most. "
                      "A large claim can be filed next month; a small booking can "
                      "only be moved in the next few hours."),
    }
