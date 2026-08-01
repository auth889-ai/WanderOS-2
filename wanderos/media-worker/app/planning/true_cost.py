"""The price you'll actually pay — the single most-cited travel frustration.

**61% of travellers name hidden or unexpected fees as their top booking
frustration. No other issue in the survey came within 24 percentage points.**
It is not close, and it is not what travel apps compete on.

The gap is structural. A flight search shows the fare. A hotel page shows the
nightly rate. Neither shows the bag, the seat, the resort fee, the tourist tax,
the airport transfer, the SIM, or the 3-4% your bank takes on every card tap.
Those are not edge cases — they are most of the difference between the number
someone budgets against and the number that leaves their account.

So this estimates the whole thing before booking, and is explicit about which
figures are **typical ranges** rather than quotes. A confident wrong total would
be worse than the fare alone: it would be a number someone plans around.

Every line says where it came from:

    QUOTED     the traveller entered a real price they were shown
    TYPICAL    a published range for this category and region
    ESTIMATED  derived from trip shape (nights, people, distance)

Nothing here is scraped from an airline. Fee schedules change constantly and a
stale scraped number presented as fact is exactly the failure this is meant to
fix.
"""
from __future__ import annotations

from dataclasses import dataclass, field

QUOTED = "quoted"
TYPICAL = "typical"
ESTIMATED = "estimated"

BASIS_NOTE = {
    QUOTED: "the price you were shown",
    TYPICAL: "published typical range — confirm before booking",
    ESTIMATED: "estimated from your trip",
}

# Typical ranges (low, high) in EUR. Deliberately ranges, not points: a single
# number invites false precision, and the honest answer to "what will the bag
# cost" is "somewhere between these, check your carrier".
TYPICAL_FEES = {
    "checked_bag_each_way": (25.0, 75.0),
    "seat_selection_each_way": (8.0, 40.0),
    "carry_on_fee_each_way": (0.0, 35.0),      # budget carriers charge for cabin bags
    "airport_transfer_each_way": (12.0, 60.0),
    "resort_fee_per_night": (0.0, 45.0),
    "city_tourist_tax_per_night_pp": (0.5, 7.0),
    "esim_or_roaming": (8.0, 35.0),
    "travel_insurance": (20.0, 90.0),
    "visa_fee": (0.0, 190.0),
    "airport_food_per_person": (12.0, 30.0),
}

# What a card actually costs abroad. The spread is invisible at the till and is
# the fee people are least aware of.
FX_SPREAD = {"typical_bank": 0.035, "good_card": 0.005, "cash_exchange": 0.06}

# Categories the traveller almost never budgets for, in the order they bite.
COMMONLY_MISSED = (
    "checked_bag_each_way", "seat_selection_each_way", "resort_fee_per_night",
    "city_tourist_tax_per_night_pp", "esim_or_roaming", "airport_transfer_each_way",
)


@dataclass
class Line:
    label: str
    low: float
    high: float
    basis: str
    detail: str = ""

    @property
    def mid(self) -> float:
        return round((self.low + self.high) / 2, 2)

    def as_dict(self) -> dict:
        return {**self.__dict__, "mid": self.mid, "basis_note": BASIS_NOTE.get(self.basis, "")}


@dataclass
class Trip:
    nights: int
    travellers: int = 1
    headline_price: float = 0.0          # the fare/rate the traveller was shown
    currency: str = "EUR"
    checked_bags: int = 0
    seat_selection: bool = False
    budget_carrier: bool = False
    resort_hotel: bool = False
    needs_visa: bool = False
    card_type: str = "typical_bank"
    expected_card_spend: float = 0.0
    quoted: dict[str, float] = field(default_factory=dict)   # anything really quoted


def _line(trip: Trip, key: str, label: str, multiplier: float = 1.0,
          detail: str = "") -> Line:
    """A quoted price always wins over a typical range."""
    if key in trip.quoted:
        value = trip.quoted[key] * multiplier
        return Line(label, value, value, QUOTED, detail or "you entered this")
    low, high = TYPICAL_FEES[key]
    return Line(label, round(low * multiplier, 2), round(high * multiplier, 2),
                TYPICAL, detail)


def estimate(trip: Trip) -> dict:
    """What the trip will really cost, and how much of it was hidden."""
    lines: list[Line] = []
    people = max(1, trip.travellers)

    if trip.headline_price:
        lines.append(Line("Headline price", trip.headline_price, trip.headline_price,
                          QUOTED, "the number you were shown"))

    if trip.checked_bags:
        lines.append(_line(trip, "checked_bag_each_way", "Checked bags",
                           multiplier=trip.checked_bags * 2,
                           detail=f"{trip.checked_bags} bag(s), both directions"))
    if trip.budget_carrier:
        lines.append(_line(trip, "carry_on_fee_each_way", "Cabin bag",
                           multiplier=people * 2,
                           detail="budget carriers often charge for the overhead bin"))
    if trip.seat_selection:
        lines.append(_line(trip, "seat_selection_each_way", "Seat selection",
                           multiplier=people * 2,
                           detail="both directions — sitting together is rarely free"))

    lines.append(_line(trip, "airport_transfer_each_way", "Airport transfers",
                       multiplier=2, detail="arrival and departure"))

    if trip.resort_hotel:
        lines.append(_line(trip, "resort_fee_per_night", "Resort fee",
                           multiplier=trip.nights,
                           detail="charged at checkout, not shown in the nightly rate"))
    lines.append(_line(trip, "city_tourist_tax_per_night_pp", "City / tourist tax",
                       multiplier=trip.nights * people,
                       detail="per person per night, usually collected at the property"))
    lines.append(_line(trip, "esim_or_roaming", "Data abroad", multiplier=people))
    lines.append(_line(trip, "travel_insurance", "Travel insurance"))
    if trip.needs_visa:
        lines.append(_line(trip, "visa_fee", "Visa / entry fee", multiplier=people))
    lines.append(_line(trip, "airport_food_per_person", "Airport food",
                       multiplier=people * 2, detail="outbound and return"))

    # The invisible one. A 3.5% spread on 800 of spending is 28 nobody counted.
    if trip.expected_card_spend:
        rate = FX_SPREAD.get(trip.card_type, FX_SPREAD["typical_bank"])
        cost = round(trip.expected_card_spend * rate, 2)
        best = round(trip.expected_card_spend * FX_SPREAD["good_card"], 2)
        lines.append(Line(
            "Currency conversion", cost, cost, ESTIMATED,
            f"{rate * 100:.1f}% on {trip.expected_card_spend:,.0f} of card spend"
            + (f" — a fee-free card would cost {best:,.0f}" if cost > best else "")))

    extras = [line for line in lines if line.label != "Headline price"]
    low = round(sum(line.low for line in extras), 2)
    high = round(sum(line.high for line in extras), 2)
    mid = round(sum(line.mid for line in extras), 2)

    headline = trip.headline_price
    uplift = round((mid / headline) * 100, 1) if headline else None

    return {
        "currency": trip.currency,
        "headline_price": headline,
        "lines": [line.as_dict() for line in lines],
        "extras_low": low,
        "extras_high": high,
        "extras_typical": mid,
        "true_total_low": round(headline + low, 2),
        "true_total_high": round(headline + high, 2),
        "true_total_typical": round(headline + mid, 2),
        # The headline number, and the point of the whole feature.
        "percent_above_headline": uplift,
        "headline_message": (
            f"The price you saw was {headline:,.0f}. You will likely pay around "
            f"{headline + mid:,.0f} — about {uplift:.0f}% more."
            if headline and uplift else
            f"Around {mid:,.0f} in fees beyond whatever fare you were quoted."
        ),
        "biggest_surprises": [
            line.as_dict() for line in sorted(extras, key=lambda l: -l.mid)[:3]
        ],
        "quoted_count": sum(1 for line in lines if line.basis == QUOTED),
        "estimated_count": sum(1 for line in lines if line.basis != QUOTED),
        "disclaimer": (
            "Typical ranges, not quotes. Fee schedules change constantly, so nothing "
            "here is scraped from a carrier — a stale number presented as fact is the "
            "problem this exists to fix. Confirm anything that matters before booking."
        ),
    }


def what_you_forgot(budgeted_categories: list[str]) -> list[dict]:
    """The fees a traveller has not budgeted for, in the order they bite.

    Pairs with `budget.status()`, which reports unbudgeted categories but does
    not say what they typically cost — a warning without a number is easy to
    dismiss.
    """
    have = {c.lower() for c in budgeted_categories}
    missing = []
    for key in COMMONLY_MISSED:
        simple = key.replace("_each_way", "").replace("_per_night", "").replace("_pp", "")
        if simple in have or key in have:
            continue
        low, high = TYPICAL_FEES[key]
        missing.append({
            "category": key,
            "typical_low": low,
            "typical_high": high,
            "note": f"most travellers do not budget for this; typically {low:.0f}-{high:.0f}",
        })
    return missing
