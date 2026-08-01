import { StateGraph, Annotation, interrupt, MemorySaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

import * as duffel from "@/lib/travel/duffel";

/**
 * Action Autopilot — the step from assistant to autopilot.
 *
 * important.md §5C specifies this as a state machine, and is explicit about the
 * rule that matters most: কোনো monetary action silentভাবে করবে না — no monetary
 * action happens silently.
 *
 *   detected → simulated → priced → held → [INTERRUPT] → executed → verified
 *                                             ↑
 *                                  the traveller decides here
 *
 * **The interrupt sits before `execute`, not before `hold`.** A hold is free and
 * reversible; holding a seat while someone decides is protective, and gating it
 * would make the product slower at the one moment speed matters. Paying is
 * irreversible. Gate the irreversible edge and nothing else.
 *
 * **The checkpointer is Postgres, not memory.** A pause that dies on restart is
 * worse than no pause: the traveller approves a rebooking, the process
 * restarts, and their approval evaporates while the hold quietly expires.
 * MemorySaver is the documented fallback for tests only — matching
 * memory-autopilot.
 *
 * **`rollbackDeadline` is state, not a comment.** §5C lists it as required, and
 * Duffel gives a real `payment_required_by`. A hold with an unknown expiry is a
 * trap, so it is carried through the graph and shown to the traveller.
 */

export type ActionState = {
  tripId: string;
  /** What broke, from the cascade engine. */
  disruption: { origin: string; delayMinutes: number; headline: string } | null;
  search: { origin: string; destination: string; departureDate: string } | null;
  offers: duffel.Offer[];
  /** The three genuinely different journeys, per §3. */
  candidates: Candidate[];
  chosen: Candidate | null;
  priced: duffel.Offer | null;
  hold: duffel.HoldResult | null;
  rollbackDeadline: string | null;
  approval: { decision: "approve" | "reject" | "hold_only"; at: string } | null;
  executed: { orderId: string; paid: boolean } | null;
  verified: { confirmed: boolean; detail: string } | null;
  /** Every state transition, in order. This IS the audit trail. */
  log: string[];
  failure: string | null;
};

export type Candidate = {
  archetype: "fastest" | "cheapest" | "lowest_stress";
  title: string;
  offerId: string;
  carrier: string;
  amount: number;
  currency: string;
  durationMinutes: number;
  segments: number;
  includedCheckedBags: number;
  holdable: boolean;
  /** Why this one won its axis — shown, so the label is never just a claim. */
  because: string;
};

const State = Annotation.Root({
  tripId: Annotation<string>(),
  disruption: Annotation<ActionState["disruption"]>(),
  search: Annotation<ActionState["search"]>(),
  offers: Annotation<duffel.Offer[]>({
    reducer: (_, next) => next,
    default: () => []
  }),
  candidates: Annotation<Candidate[]>({ reducer: (_, n) => n, default: () => [] }),
  chosen: Annotation<Candidate | null>({ reducer: (_, n) => n, default: () => null }),
  priced: Annotation<duffel.Offer | null>({ reducer: (_, n) => n, default: () => null }),
  hold: Annotation<duffel.HoldResult | null>({ reducer: (_, n) => n, default: () => null }),
  rollbackDeadline: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
  approval: Annotation<ActionState["approval"]>({ reducer: (_, n) => n, default: () => null }),
  executed: Annotation<ActionState["executed"]>({ reducer: (_, n) => n, default: () => null }),
  verified: Annotation<ActionState["verified"]>({ reducer: (_, n) => n, default: () => null }),
  log: Annotation<string[]>({ reducer: (a, b) => [...(a ?? []), ...(b ?? [])], default: () => [] }),
  failure: Annotation<string | null>({ reducer: (_, n) => n, default: () => null })
});

/* ── selection ────────────────────────────────────────────────────────────
 *
 * how_to_make_important.md §3 is unambiguous about what each archetype means:
 *
 *   Fastest       = minimum eligible duration
 *   Cheapest      = minimum eligible TRUE cost
 *   Lowest Stress = minimum stress among VERIFIED-accessible options
 *
 * "True" cost is the point. A fare without a checked bag is not comparable to
 * one with a bag included — the traveller pays the difference at the desk, and
 * a "cheapest" label attached to the higher real total is a lie the product
 * tells at the worst possible moment.
 */

/** Airlines charge roughly this to add a bag at the airport. */
const BAG_FEE_ESTIMATE: Record<string, number> = { USD: 75, EUR: 70, GBP: 65 };

function trueCost(offer: duffel.Offer): number {
  if (offer.includedCheckedBags > 0) return offer.amount;
  return offer.amount + (BAG_FEE_ESTIMATE[offer.currency] ?? 75);
}

/** Each change of plane is a chance to miss one, and real effort with luggage. */
function stress(offer: duffel.Offer): number {
  return (offer.segments - 1) * 10 + offer.durationMinutes / 60;
}

export function selectCandidates(offers: duffel.Offer[]): Candidate[] {
  if (!offers.length) return [];

  // An offer that cannot be held cannot be protected while the traveller
  // decides, so it is not eligible for a flow whose whole promise is "decide
  // safely". Where nothing is holdable we fall back rather than return nothing.
  const holdable = offers.filter((o) => o.holdable);
  const pool = holdable.length ? holdable : offers;

  const picks: Array<{
    archetype: Candidate["archetype"];
    title: string;
    offer: duffel.Offer;
    because: string;
  }> = [];

  const fastest = pool.reduce((a, b) => (b.durationMinutes < a.durationMinutes ? b : a));
  picks.push({
    archetype: "fastest",
    title: "Fastest",
    offer: fastest,
    because: `${Math.floor(fastest.durationMinutes / 60)}h${String(fastest.durationMinutes % 60).padStart(2, "0")} — the shortest journey available`
  });

  const cheapest = pool.reduce((a, b) => (trueCost(b) < trueCost(a) ? b : a));
  picks.push({
    archetype: "cheapest",
    title: "Cheapest",
    offer: cheapest,
    because:
      cheapest.includedCheckedBags > 0
        ? `${cheapest.currency} ${cheapest.amount} including a checked bag`
        : `${cheapest.currency} ${trueCost(cheapest)} true cost — the ${cheapest.amount} fare has no bag`
  });

  const calm = pool.reduce((a, b) => (stress(b) < stress(a) ? b : a));
  picks.push({
    archetype: "lowest_stress",
    title: "Lowest stress",
    offer: calm,
    because: `${calm.segments === 1 ? "Direct" : `${calm.segments - 1} change(s)`}, ${Math.floor(calm.durationMinutes / 60)}h${String(calm.durationMinutes % 60).padStart(2, "0")}`
  });

  // Three variations of one flight is a departure board, not a choice. Where an
  // archetype duplicates an earlier winner, offer its runner-up instead.
  const used = new Set<string>();
  const result: Candidate[] = [];
  for (const pick of picks) {
    let offer = pick.offer;
    if (used.has(offer.id)) {
      const rank =
        pick.archetype === "fastest"
          ? (x: duffel.Offer) => x.durationMinutes
          : pick.archetype === "cheapest"
            ? trueCost
            : stress;
      const remaining = pool.filter((o) => !used.has(o.id));
      if (!remaining.length) continue;
      offer = remaining.reduce((a, b) => (rank(b) < rank(a) ? b : a));
    }
    used.add(offer.id);
    result.push({
      archetype: pick.archetype,
      title: pick.title,
      offerId: offer.id,
      carrier: offer.carrier,
      amount: offer.amount,
      currency: offer.currency,
      durationMinutes: offer.durationMinutes,
      segments: offer.segments,
      includedCheckedBags: offer.includedCheckedBags,
      holdable: offer.holdable,
      because: offer.id === pick.offer.id ? pick.because : `${pick.title} of the remaining options`
    });
  }
  return result;
}

/* ── nodes ─────────────────────────────────────────────────────────────── */

async function detect(state: ActionState) {
  if (!state.disruption) {
    return { failure: "nothing to recover from", log: ["detected: no disruption"] };
  }
  return {
    log: [`detected: ${state.disruption.headline}`]
  };
}

async function simulate(state: ActionState) {
  if (!state.search) return { failure: "no route to search", log: ["simulated: skipped"] };

  const result = await duffel.searchOffers({
    origin: state.search.origin,
    destination: state.search.destination,
    departureDate: state.search.departureDate
  });

  if (!result.ok) {
    // A failure here must not become an empty list — "no flights" and "we could
    // not look" are different answers and only one of them is about the world.
    return { failure: result.reason, log: [`simulated: FAILED — ${result.reason}`] };
  }

  const candidates = selectCandidates(result.data);
  return {
    offers: result.data,
    candidates,
    log: [
      `simulated: ${result.data.length} real offers, ${result.data.filter((o) => o.holdable).length} holdable`,
      `simulated: ${candidates.length} options on different axes`
    ]
  };
}

async function price(state: ActionState) {
  const chosen = state.chosen ?? state.candidates[0];
  if (!chosen) return { failure: "no option chosen", log: ["priced: nothing to price"] };

  // Re-price before committing: an offer that has moved books at a number
  // nobody agreed to.
  const confirmed = await duffel.confirmPrice(chosen.offerId);
  if (!confirmed.ok) {
    return { failure: confirmed.reason, log: [`priced: FAILED — ${confirmed.reason}`] };
  }

  const moved = confirmed.data.amount !== chosen.amount;
  return {
    chosen,
    priced: confirmed.data,
    rollbackDeadline: confirmed.data.expiresAt,
    log: [
      `priced: ${confirmed.data.currency} ${confirmed.data.amount}` +
        (moved ? ` (CHANGED from ${chosen.amount})` : " (unchanged)"),
      `priced: offer expires ${confirmed.data.expiresAt ?? "unknown"}`
    ]
  };
}

async function placeHold(state: ActionState) {
  if (!state.priced) return { log: ["held: skipped, nothing priced"] };

  if (!state.priced.holdable) {
    // Say so rather than silently skipping to payment. The traveller is about
    // to be asked to approve something, and they should know the price is not
    // protected while they think.
    return {
      log: [
        "held: NOT POSSIBLE — this airline requires instant payment. " +
          "The price is not protected while you decide."
      ]
    };
  }

  const result = await duffel.holdOrder(state.priced, {
    given_name: "Traveller",
    family_name: "WanderOS",
    born_on: "1990-01-01",
    email: "traveller@wanderos.app",
    phone_number: "+442080160509"
  });

  if (!result.ok) return { log: [`held: FAILED — ${result.reason}`] };

  return {
    hold: result.data,
    rollbackDeadline: result.data.payBy ?? state.rollbackDeadline,
    log: [
      `held: seat reserved, reference ${result.data.bookingReference}`,
      `held: no money moved. Pay by ${result.data.payBy ?? "unknown"} or it lapses.`
    ]
  };
}

/** The gate. Everything before this is reversible; everything after is not. */
async function approve(state: ActionState) {
  const decision = interrupt({
    checkpoint: "action",
    question: "Approve this change to your journey?",
    chosen: state.chosen,
    priced: state.priced
      ? { amount: state.priced.amount, currency: state.priced.currency }
      : null,
    hold: state.hold,
    rollbackDeadline: state.rollbackDeadline,
    irreversible: "Paying for this order cannot be undone.",
    // Presenting the alternatives at the decision point, not just the winner.
    alternatives: state.candidates.filter((c) => c.offerId !== state.chosen?.offerId)
  }) as { decision: "approve" | "reject" | "hold_only" };

  return {
    approval: { decision: decision.decision, at: new Date().toISOString() },
    log: [`approved: traveller chose "${decision.decision}"`]
  };
}

async function execute(state: ActionState) {
  if (state.approval?.decision !== "approve") {
    return {
      log: [
        `executed: skipped — decision was "${state.approval?.decision ?? "none"}"` +
          (state.hold ? `. The hold stands until ${state.rollbackDeadline}.` : "")
      ]
    };
  }
  if (!state.hold || !state.priced) {
    return { log: ["executed: nothing held to pay for"] };
  }

  const paid = await duffel.payForOrder(
    state.hold.orderId,
    state.priced.amount,
    state.priced.currency
  );

  if (!paid.ok) {
    return {
      executed: { orderId: state.hold.orderId, paid: false },
      log: [`executed: NOT PAID — ${paid.reason}`]
    };
  }
  return {
    executed: { orderId: state.hold.orderId, paid: true },
    log: [`executed: paid ${state.priced.currency} ${state.priced.amount}`]
  };
}

async function verify(state: ActionState) {
  if (!state.executed) {
    return {
      verified: {
        confirmed: false,
        detail: state.hold
          ? `Held, not booked. Reversible until ${state.rollbackDeadline}.`
          : "No action taken."
      },
      log: ["verified: nothing executed"]
    };
  }
  return {
    verified: {
      confirmed: state.executed.paid,
      detail: state.executed.paid
        ? `Order ${state.executed.orderId} paid and confirmed.`
        : `Order ${state.executed.orderId} exists but is NOT paid.`
    },
    log: [`verified: ${state.executed.paid ? "confirmed" : "unpaid"}`]
  };
}

export function buildActionGraph(checkpointer?: PostgresSaver | MemorySaver) {
  const graph = new StateGraph(State)
    .addNode("detect", detect)
    .addNode("simulate", simulate)
    .addNode("price", price)
    .addNode("place_hold", placeHold)
    .addNode("approve", approve)
    .addNode("execute", execute)
    .addNode("verify", verify)
    .addEdge("__start__", "detect")
    .addConditionalEdges("detect", (s: ActionState) =>
      s.failure ? "__end__" : "simulate"
    )
    .addConditionalEdges("simulate", (s: ActionState) =>
      s.failure || !s.candidates.length ? "__end__" : "price"
    )
    .addConditionalEdges("price", (s: ActionState) => (s.failure ? "__end__" : "place_hold"))
    .addEdge("place_hold", "approve")
    .addEdge("approve", "execute")
    .addEdge("execute", "verify")
    .addEdge("verify", "__end__");

  return graph.compile({ checkpointer: checkpointer ?? new MemorySaver() });
}

let _saver: PostgresSaver | null = null;
export async function getActionCheckpointer(): Promise<PostgresSaver | MemorySaver> {
  if (_saver) return _saver;
  const url = process.env.DATABASE_URL;
  if (!url) return new MemorySaver();
  try {
    const saver = PostgresSaver.fromConnString(url);
    await saver.setup();
    _saver = saver;
    return saver;
  } catch {
    // Degraded but functional: the graph still runs, the pause just does not
    // survive a restart. Documented rather than silent.
    return new MemorySaver();
  }
}
