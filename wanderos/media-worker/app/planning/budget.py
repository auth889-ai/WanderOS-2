"""Feature 12 — Budget Autopilot.

A travel budget is not "flights + hotel". It is flights, hotel, luggage fees,
taxes, visa fees, airport transfers, a SIM, food, tickets, the exchange-rate
move between booking and spending, and the emergency purchase nobody plans for.
People run out of money on day nine of a twelve-day trip because they tracked
two of those eleven.

The distinction that makes this useful is that **money has states, not just a
total**:

    PLANNED     an intention, still fully changeable
    COMMITTED   paid or contractually owed — this money is gone
    REFUNDABLE  paid, but recoverable if cancelled in time
    ACTUAL      really spent
    AT_RISK     committed to something that may not happen (a non-refundable
                booking on a day whose flight is already delayed)

"You have 400 left" is misleading when 350 of it is a non-refundable deposit.
The number that matters is what is still *changeable*, and that is what
rebalancing operates on — it will never suggest cancelling something already
committed, because that saves nothing.

An emergency reserve is held back by default and is not counted as available.
A budget with no slack is how a lost wallet becomes a stranded traveller.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

DEFAULT_RESERVE_FRACTION = 0.10  # held back, never offered as spendable

# The categories travellers forget. Present so the engine can say "you have not
# budgeted for X" rather than silently agreeing the plan is affordable.
OFTEN_FORGOTTEN = (
    "baggage_fees", "airport_transfer", "tourist_tax", "visa_fee", "sim_data",
    "tips", "travel_insurance", "currency_spread", "seat_selection",
)


class State(str, Enum):
    PLANNED = "planned"
    COMMITTED = "committed"
    REFUNDABLE = "refundable"
    ACTUAL = "actual"
    AT_RISK = "at_risk"


@dataclass
class Expense:
    name: str
    category: str
    amount: float
    state: State = State.PLANNED
    day: int | None = None
    swappable_to: float | None = None   # a realistic cheaper alternative
    note: str = ""

    @property
    def changeable(self) -> bool:
        """Only planned and refundable money can still be saved.

        Cancelling a committed expense frees nothing — the point of separating
        the states is to stop the engine proposing exactly that.
        """
        return self.state in (State.PLANNED, State.REFUNDABLE)

    def as_dict(self) -> dict:
        return {**self.__dict__, "state": self.state.value, "changeable": self.changeable}


@dataclass
class Budget:
    total: float
    currency: str = "EUR"
    expenses: list[Expense] = field(default_factory=list)
    reserve_fraction: float = DEFAULT_RESERVE_FRACTION

    def reserve(self) -> float:
        return round(self.total * self.reserve_fraction, 2)

    def by_state(self, state: State) -> float:
        return round(sum(e.amount for e in self.expenses if e.state is state), 2)

    def spent_or_owed(self) -> float:
        """Money gone or contractually gone."""
        return round(sum(e.amount for e in self.expenses
                         if e.state in (State.ACTUAL, State.COMMITTED, State.AT_RISK)), 2)

    def changeable_total(self) -> float:
        return round(sum(e.amount for e in self.expenses if e.changeable), 2)


def status(budget: Budget) -> dict:
    committed = budget.spent_or_owed()
    planned = budget.changeable_total()
    reserve = budget.reserve()
    projected = round(committed + planned, 2)
    available = round(budget.total - reserve - projected, 2)

    missing = [c for c in OFTEN_FORGOTTEN
               if not any(e.category == c for e in budget.expenses)]

    return {
        "total": budget.total,
        "currency": budget.currency,
        "reserve_held_back": reserve,
        "actual": budget.by_state(State.ACTUAL),
        "committed": budget.by_state(State.COMMITTED),
        "refundable": budget.by_state(State.REFUNDABLE),
        "planned": budget.by_state(State.PLANNED),
        "at_risk": budget.by_state(State.AT_RISK),
        "projected_total": projected,
        "available": available,
        "over_budget_by": round(-available, 2) if available < 0 else 0.0,
        # The honest headline: not "you have X left" but "X is still yours to move".
        "still_changeable": planned,
        "unbudgeted_categories": missing,
        "warning": (
            "Costs not yet budgeted: " + ", ".join(missing)
            if missing else ""
        ),
    }


def rebalance(budget: Budget, *, target: float | None = None) -> dict:
    """Propose cuts to get back under budget, cheapest sacrifice first.

    Only touches changeable money. Ordering is by how much is saved per unit of
    disruption: swapping something for a cheaper version is always preferred to
    dropping it, because a traveller who is told to cancel the one thing they
    came for will ignore the whole tool.
    """
    state = status(budget)
    shortfall = target if target is not None else state["over_budget_by"]
    if shortfall <= 0:
        return {"needed": 0.0, "actions": [], "achievable": True,
                "message": "within budget; no changes needed"}

    actions: list[dict] = []
    saved = 0.0

    # 1. Swaps — keep the experience, lower the price.
    swaps = sorted(
        (e for e in budget.expenses if e.changeable and e.swappable_to is not None
         and e.swappable_to < e.amount),
        key=lambda e: (e.amount - e.swappable_to), reverse=True)
    for e in swaps:
        if saved >= shortfall:
            break
        delta = round(e.amount - e.swappable_to, 2)
        actions.append({"action": "swap", "item": e.name, "category": e.category,
                        "from": e.amount, "to": e.swappable_to, "saves": delta,
                        "keeps_the_experience": True})
        saved = round(saved + delta, 2)

    # 2. Drops — only if swapping was not enough, largest first so the fewest
    #    things are lost.
    if saved < shortfall:
        drops = sorted((e for e in budget.expenses
                        if e.changeable and not any(a["item"] == e.name for a in actions)),
                       key=lambda e: e.amount, reverse=True)
        for e in drops:
            if saved >= shortfall:
                break
            actions.append({"action": "drop", "item": e.name, "category": e.category,
                            "saves": e.amount, "keeps_the_experience": False})
            saved = round(saved + e.amount, 2)

    return {
        "needed": round(shortfall, 2),
        "found": saved,
        "achievable": saved >= shortfall,
        "actions": actions,
        "shortfall_remaining": round(max(0.0, shortfall - saved), 2),
        # Said explicitly, because the alternative is a tool that quietly
        # proposes cancelling a paid flight.
        "untouchable": round(budget.spent_or_owed(), 2),
        "message": (
            f"{saved:.2f} of {shortfall:.2f} found in changeable spend"
            + ("" if saved >= shortfall else
               f"; {shortfall - saved:.2f} short — the rest is already committed "
               f"and cancelling it would save nothing")
        ),
    }


def flag_at_risk(budget: Budget, *, disrupted_days: set[int]) -> list[dict]:
    """Mark non-refundable spend on days a disruption already threatens.

    Composes with the Passenger Rights engine: when a flight is delayed into
    day 3, the non-refundable day-3 tour is money about to evaporate, and the
    traveller can often still move it if told today rather than discovering it
    on arrival.
    """
    flagged = []
    for e in budget.expenses:
        if e.day in disrupted_days and e.state is State.COMMITTED:
            e.state = State.AT_RISK
            flagged.append({"item": e.name, "day": e.day, "amount": e.amount,
                            "why": "non-refundable and booked on a disrupted day",
                            "action": "contact the operator to move it while you still can"})
    return flagged
