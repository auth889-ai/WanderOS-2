"""Passenger Rights Engine — what a disrupted traveller is plausibly owed.

The real problem: entitlements exist and mostly go unclaimed. Airlines are not
obliged to volunteer that a three-hour delay may be worth EUR 600, the rules
differ by jurisdiction, and the deadlines are short enough that a traveller who
finds out a month later has already lost baggage claims.

Design rules, because this touches money and law:

- **Deterministic, never generative.** Every output traces to a cited article.
  A model is not asked "is this claimable" — the thresholds are code.
- **Never assert entitlement.** The airline and the regulator decide. This says
  what a rule *provides for* and what still has to be established (chiefly
  whether the cause was extraordinary), and it says so in the wording.
- **Fail toward "check", not toward "no".** An unknown cause yields a claim
  marked as needing confirmation rather than being silently dropped, because a
  false negative here costs the traveller real money.
- **Care is separate from compensation.** Under EC261 the right to meals and a
  hotel survives extraordinary circumstances even when compensation does not —
  conflating them is the single most common way travellers are underserved.

This is informational, not legal advice. Monetary limits are periodically
revised; each figure below carries the revision it came from.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.common.geo import great_circle_km

DISCLAIMER = (
    "Informational only, not legal advice. Whether compensation is actually due "
    "depends on the cause of the disruption, which the airline must establish."
)

# --- EC261/2004 -------------------------------------------------------------
# Article 7 compensation bands, by great-circle distance to the FINAL destination.
EC261_BANDS = [
    # (max_km, intra_eu_only, amount_eur)
    (1500, False, 250),
    (3500, False, 400),
    (float("inf"), False, 600),
]
# Article 6 delay thresholds for the right to CARE, by the same distance bands.
EC261_CARE_HOURS = [(1500, 2), (3500, 3), (float("inf"), 4)]
# Article 6(1)(iii)/Article 8: a 5-hour delay unlocks the right to a refund.
EC261_REFUND_DELAY_HOURS = 5
# Sturgeon (C-402/07): arrival delays of 3h+ are compensated as cancellations.
EC261_COMPENSATION_DELAY_HOURS = 3

# Causes the Court has generally treated as extraordinary. Presence here does not
# settle it — the airline still bears the burden of proof (Article 5(3)).
EXTRAORDINARY_CAUSES = {
    "weather", "air_traffic_control_strike", "security_risk", "political_instability",
    "bird_strike", "medical_emergency", "airport_closure",
}
# Causes the Court has held are NOT extraordinary — inherent to running an airline.
NOT_EXTRAORDINARY_CAUSES = {
    "technical_fault", "crew_shortage", "airline_staff_strike", "overbooking",
    "late_inbound_aircraft", "scheduling",
}

# --- US DOT (14 CFR 250.5) — involuntary denied boarding, 2024 figures --------
DOT_DENIED_BOARDING = {
    "domestic": [(1, 0, 0), (2, 2.0, 775), (float("inf"), 4.0, 1550)],
    "international": [(1, 0, 0), (4, 2.0, 775), (float("inf"), 4.0, 1550)],
}
# 2024 DOT rule: automatic refunds once a change crosses these thresholds.
DOT_REFUND_HOURS = {"domestic": 3, "international": 6}

# --- Montreal Convention 1999 (limits as revised 2019, in SDR) ---------------
MONTREAL_SDR = {"baggage": 1288, "passenger_delay": 5346, "death_injury": 128821}
MONTREAL_DEADLINE_DAYS = {"damage": 7, "delay": 21, "loss": 21}


@dataclass
class Flight:
    departure_airport: str
    arrival_airport: str
    departure_country: str          # ISO-2
    arrival_country: str            # ISO-2
    carrier_country: str            # ISO-2 of the operating carrier
    scheduled_arrival: datetime
    actual_arrival: datetime | None = None
    departure_latlon: tuple[float, float] | None = None
    arrival_latlon: tuple[float, float] | None = None
    distance_km: float | None = None
    cause: str = "unknown"
    notice_days: int | None = None  # days of warning for a cancellation
    fare_paid: float | None = None
    disruption: str = "delay"       # delay | cancellation | denied_boarding

    def delay_hours(self) -> float:
        if self.actual_arrival is None:
            return 0.0
        return max(0.0, (self.actual_arrival - self.scheduled_arrival).total_seconds() / 3600)

    def resolved_distance_km(self) -> float | None:
        if self.distance_km is not None:
            return self.distance_km
        if self.departure_latlon and self.arrival_latlon:
            return great_circle_km(*self.departure_latlon, *self.arrival_latlon)
        return None


@dataclass
class Entitlement:
    regime: str
    kind: str                     # compensation | care | refund | baggage
    article: str
    amount: float | None = None
    currency: str = "EUR"
    confidence: str = "likely"    # likely | conditional | unavailable
    reason: str = ""
    action_required: str = ""
    deadline: str = ""

    def as_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items()}


# EU + EEA + UK. Post-Brexit the UK runs UK261, a near-identical regime in GBP;
# treating it as in-scope here and naming the regime accordingly is more useful
# than dropping UK flights entirely.
_EU_EEA = {
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
    "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES",
    "SE", "IS", "LI", "NO",
}


def _ec261_applies(f: Flight) -> tuple[bool, str]:
    """Article 3 scope: departing the EU on any carrier, or arriving in the EU
    from outside on a Community carrier."""
    if f.departure_country in _EU_EEA or f.departure_country == "GB":
        return True, "departed from an EU/EEA/UK airport (applies to any carrier)"
    arriving_eu = f.arrival_country in _EU_EEA or f.arrival_country == "GB"
    carrier_eu = f.carrier_country in _EU_EEA or f.carrier_country == "GB"
    if arriving_eu and carrier_eu:
        return True, "arrived in the EU/EEA/UK on an EU/UK carrier"
    return False, "neither departs the EU/UK nor arrives on an EU/UK carrier"


def _band_amount(distance_km: float, intra_eu: bool) -> int:
    if distance_km <= 1500:
        return 250
    if intra_eu or distance_km <= 3500:
        return 400
    return 600


def _care_threshold_hours(distance_km: float) -> int:
    for max_km, hours in EC261_CARE_HOURS:
        if distance_km <= max_km:
            return hours
    return 4


def _cause_verdict(cause: str) -> tuple[str, str]:
    """Returns (confidence, explanation) for whether compensation survives."""
    if cause in NOT_EXTRAORDINARY_CAUSES:
        return "likely", f"'{cause}' is inherent to operating an airline and has not been accepted as extraordinary"
    if cause in EXTRAORDINARY_CAUSES:
        return "unavailable", f"'{cause}' is generally treated as extraordinary, which removes the compensation duty (Article 5(3))"
    return "conditional", "the cause is unconfirmed; compensation depends on whether the airline can show extraordinary circumstances"


def assess_ec261(f: Flight) -> list[Entitlement]:
    out: list[Entitlement] = []
    applies, scope_reason = _ec261_applies(f)
    regime = "UK261" if (f.departure_country == "GB" or f.arrival_country == "GB") else "EC261/2004"
    currency = "GBP" if regime == "UK261" else "EUR"
    if not applies:
        return [Entitlement(regime=regime, kind="compensation", article="Article 3",
                            confidence="unavailable", reason=scope_reason)]

    distance = f.resolved_distance_km()
    if distance is None:
        return [Entitlement(regime=regime, kind="compensation", article="Article 7",
                            confidence="conditional",
                            reason="compensation is banded by great-circle distance, which is unknown here",
                            action_required="supply departure/arrival coordinates or the distance")]

    intra_eu = ((f.departure_country in _EU_EEA or f.departure_country == "GB")
                and (f.arrival_country in _EU_EEA or f.arrival_country == "GB"))
    amount = _band_amount(distance, intra_eu)
    delay = f.delay_hours()

    # --- Compensation ---
    if f.disruption == "cancellation" and (f.notice_days is None or f.notice_days < 14):
        conf, why = _cause_verdict(f.cause)
        out.append(Entitlement(
            regime=regime, kind="compensation", article="Articles 5 & 7", amount=amount,
            currency=currency, confidence=conf,
            reason=f"cancelled with {f.notice_days if f.notice_days is not None else 'unknown'} days notice "
                   f"(under 14 days); {why}",
            action_required="claim in writing to the operating carrier",
            deadline="varies by member state (commonly 2-6 years)"))
    elif f.disruption == "denied_boarding":
        out.append(Entitlement(
            regime=regime, kind="compensation", article="Articles 4 & 7", amount=amount,
            currency=currency, confidence="likely",
            reason="involuntary denied boarding is compensated regardless of cause",
            action_required="claim in writing to the operating carrier"))
    elif delay >= EC261_COMPENSATION_DELAY_HOURS:
        conf, why = _cause_verdict(f.cause)
        # Article 7(2): re-routing that limits the arrival delay halves the amount.
        reduced = distance > 3500 and not intra_eu and delay < 4
        final = amount // 2 if reduced else amount
        out.append(Entitlement(
            regime=regime, kind="compensation", article="Article 7 (per Sturgeon C-402/07)",
            amount=final, currency=currency, confidence=conf,
            reason=f"arrival delay of {delay:.1f}h over {distance:.0f}km; {why}"
                   + (" — halved under Article 7(2) for a delay under 4h on a long-haul flight" if reduced else ""),
            action_required="claim in writing to the operating carrier"))

    # --- Care: survives extraordinary circumstances. This is the part travellers
    #     are most often wrongly refused. ---
    care_hours = _care_threshold_hours(distance)
    if delay >= care_hours or f.disruption in ("cancellation", "denied_boarding"):
        out.append(Entitlement(
            regime=regime, kind="care", article="Articles 6 & 9", amount=None, currency=currency,
            confidence="likely",
            reason=f"delay of {delay:.1f}h meets the {care_hours}h threshold for this distance band. "
                   "The right to care applies EVEN IF the cause was extraordinary",
            action_required="keep receipts for meals, phone calls and any hotel and transfer"))

    # --- Refund / re-routing ---
    if delay >= EC261_REFUND_DELAY_HOURS or f.disruption == "cancellation":
        out.append(Entitlement(
            regime=regime, kind="refund", article="Article 8", amount=None, currency=currency,
            confidence="likely",
            reason="a delay of 5h or more, or a cancellation, entitles the passenger to choose "
                   "a full refund instead of travelling",
            action_required="tell the carrier whether you want a refund or re-routing"))
    return out


def assess_us_dot(f: Flight) -> list[Entitlement]:
    out: list[Entitlement] = []
    if "US" not in (f.departure_country, f.arrival_country):
        return out
    scope = "domestic" if f.departure_country == f.arrival_country == "US" else "international"

    if f.disruption == "denied_boarding":
        delay = f.delay_hours()
        for max_h, multiple, cap in DOT_DENIED_BOARDING[scope]:
            if delay < max_h:
                if multiple == 0:
                    out.append(Entitlement(
                        regime="US DOT", kind="compensation", article="14 CFR 250.5",
                        amount=0, currency="USD", confidence="unavailable",
                        reason=f"rebooked within {max_h}h, below the threshold for denied-boarding compensation"))
                else:
                    amount = min(f.fare_paid * multiple, cap) if f.fare_paid else None
                    out.append(Entitlement(
                        regime="US DOT", kind="compensation", article="14 CFR 250.5",
                        amount=amount, currency="USD", confidence="likely",
                        reason=f"involuntary denied boarding, {scope}: {int(multiple * 100)}% of the one-way "
                               f"fare, capped at ${cap} (2024 figures)"
                               + ("" if f.fare_paid else " — supply the fare to compute the amount"),
                        action_required="request the payment at the airport; it is due the same day"))
                break

    threshold = DOT_REFUND_HOURS[scope]
    if f.disruption == "cancellation" or f.delay_hours() >= threshold:
        out.append(Entitlement(
            regime="US DOT", kind="refund", article="2024 DOT refund rule",
            amount=None, currency="USD", confidence="likely",
            reason=f"cancellation, or a change of {threshold}h or more ({scope}), requires an "
                   "AUTOMATIC cash refund — you do not have to accept a voucher",
            action_required="decline vouchers and request the cash refund"))

    # Deliberately stated: the absence of a rule is itself useful information.
    if f.disruption == "delay" and scope == "domestic" and not out:
        out.append(Entitlement(
            regime="US DOT", kind="compensation", article="—",
            amount=0, currency="USD", confidence="unavailable",
            reason="US law mandates no compensation for domestic delays; any payment is the "
                   "airline's own policy. This is the main way US and EU rights differ"))
    return out


def assess_baggage(*, incident: str, reported_days_after: int | None,
                   value_claimed: float | None = None) -> list[Entitlement]:
    """Montreal Convention baggage liability. `incident` is damage|delay|loss."""
    deadline = MONTREAL_DEADLINE_DAYS.get(incident)
    limit_sdr = MONTREAL_SDR["baggage"]
    missed = reported_days_after is not None and deadline is not None and reported_days_after > deadline
    return [Entitlement(
        regime="Montreal Convention 1999", kind="baggage", article="Articles 17, 22, 31",
        amount=limit_sdr, currency="SDR",
        confidence="unavailable" if missed else "likely",
        reason=(f"reported {reported_days_after} days after the event, past the {deadline}-day "
                f"limit for {incident} — the claim is likely time-barred"
                if missed else
                f"carrier liability for baggage {incident} up to {limit_sdr} SDR "
                f"(~USD 1,700; limits revised 2019 and reviewed periodically)")
               + (f"; claimed value {value_claimed}" if value_claimed else ""),
        action_required=("" if missed else
                         f"file a written Property Irregularity Report within {deadline} days"),
        deadline=f"{deadline} days from receipt/arrival" if deadline else "")]


def assess(flight: Flight, *, baggage: dict[str, Any] | None = None) -> dict:
    """Full assessment across every regime that could apply to one disruption."""
    entitlements = assess_ec261(flight) + assess_us_dot(flight)
    if baggage:
        entitlements += assess_baggage(
            incident=baggage.get("incident", "delay"),
            reported_days_after=baggage.get("reported_days_after"),
            value_claimed=baggage.get("value_claimed"))

    claimable = [e for e in entitlements if e.confidence in ("likely", "conditional")]
    money = sum(e.amount for e in claimable
                if e.amount and e.currency in ("EUR", "GBP", "USD"))
    return {
        "flight": f"{flight.departure_airport}->{flight.arrival_airport}",
        "disruption": flight.disruption,
        "delay_hours": round(flight.delay_hours(), 2),
        "distance_km": round(flight.resolved_distance_km() or 0),
        "entitlements": [e.as_dict() for e in entitlements],
        "claimable_count": len(claimable),
        "headline_amount": money or None,
        # Everything the traveller must physically do, deduplicated, in one list.
        "next_steps": sorted({e.action_required for e in claimable if e.action_required}),
        "disclaimer": DISCLAIMER,
    }
