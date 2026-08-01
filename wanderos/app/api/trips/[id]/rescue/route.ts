import { NextRequest, NextResponse } from "next/server";

import * as A from "@/lib/db/tables/journey-actions";
import { toWorkerPayload } from "@/lib/db/tables/commitments";
import { getTripById } from "@/lib/db/tables/trips";
import { queryAurora } from "@/lib/db/pool";
import { stepFreeRoute } from "@/lib/travel/accessibility";
import * as duffel from "@/lib/travel/duffel";

/**
 * GET  /api/trips/:id/rescue?commitment=flight   the rescue, restored or started
 * POST /api/trips/:id/rescue                     approve / reject / verify
 *
 * Everything here reads from something that already exists: the cascade engine
 * for what breaks, Duffel for real inventory, ORS for the walking a wheelchair
 * user actually faces, and `journey_actions` for what has already been decided.
 *
 * **A reload restores rather than restarts.** The persisted action is the source
 * of truth for state and for the options as presented — re-searching on every
 * page load would show the traveller different prices than the ones they were
 * about to approve.
 */

const WORKER = process.env.MEDIA_WORKER_URL ?? "http://127.0.0.1:8000";

/** Airlines charge roughly this to add a bag at the airport. */
const BAG_FEE: Record<string, number> = { USD: 75, EUR: 70, GBP: 65 };

/**
 * The route to search, taken from the broken commitment rather than assumed.
 *
 * A label like "Flight EK582 DXB-LHR" carries the airports; a commitment that
 * does not name them cannot be rescued by guessing, so the caller is told
 * rather than shown alternatives for somebody else's journey.
 */
function routeFrom(
  broken: { label?: string; consequence?: string },
  trip: { destination?: string }
): { origin: string; destination: string } | null {
  const text = `${broken.label ?? ""} ${broken.consequence ?? ""}`;
  const pair = text.match(/\b([A-Z]{3})\b[^A-Z]{1,4}\b([A-Z]{3})\b/);
  if (pair) return { origin: pair[1], destination: pair[2] };

  const single = text.match(/\b([A-Z]{3})\b/);
  const arrival = CITY_AIRPORT[(trip.destination ?? "").toLowerCase()];
  if (single && arrival && single[1] !== arrival) {
    return { origin: single[1], destination: arrival };
  }
  return null;
}

/** Enough to resolve a destination the traveller typed. Extend as needed —
 *  an unknown city returns null rather than a wrong airport. */
const CITY_AIRPORT: Record<string, string> = {
  london: "LHR", paris: "CDG", "new york": "JFK", dubai: "DXB",
  tokyo: "HND", singapore: "SIN", amsterdam: "AMS", madrid: "MAD",
  rome: "FCO", berlin: "BER", barcelona: "BCN", istanbul: "IST",
  dhaka: "DAC", bangkok: "BKK", sydney: "SYD", toronto: "YYZ"
};

/**
 * Where the arrival transfer actually happens.
 *
 * Geocoded from the trip's own destination via Open-Meteo, so a trip to Rome
 * measures walking in Rome. Falls back to no route rather than to London — a
 * confident walking distance for the wrong city is worse than none.
 */
async function arrivalTransfer(
  destination: string
): Promise<{ from: [number, number]; to: [number, number] } | null> {
  if (!destination) return null;
  try {
    const response = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(destination)}&count=1`,
      { signal: AbortSignal.timeout(15_000) }
    );
    if (!response.ok) return null;
    const first = (await response.json())?.results?.[0];
    if (!first) return null;
    const lon = Number(first.longitude);
    const lat = Number(first.latitude);
    // A short transfer leg through the city centre: roughly 2-3 km, which is
    // the scale of a real station-to-accommodation walk.
    return { from: [lon - 0.018, lat + 0.014], to: [lon + 0.010, lat - 0.012] };
  } catch {
    return null;
  }
}

/**
 * The traveller the seat is held for — read from the trip's owner.
 *
 * A hold under a placeholder name is a hold for nobody: the airline matches
 * the passenger against the name on the document, and a booking made out to
 * "Traveller WanderOS" cannot be flown. Where the record has no usable name
 * the hold is refused rather than made under a fiction.
 */
async function passengerFor(tripId: string): Promise<
  { given_name: string; family_name: string; email: string } | null
> {
  const rows = await queryAurora<{ name: string; email: string }>(
    `select u.name, u.email from users u
       join trips t on t.traveler_id = u.id
      where t.id = $1`,
    [tripId]
  );
  const user = rows[0];
  if (!user?.name?.trim() || !user?.email?.trim()) return null;

  const parts = user.name.trim().split(/\s+/);
  if (parts.length < 2) return null;   // an airline needs both names
  return {
    given_name: parts[0],
    family_name: parts.slice(1).join(" "),
    email: user.email
  };
}

/** A calendar day from a Date, an ISO string, or nothing. */
function isoDay(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

function trueCost(o: duffel.Offer): number {
  return o.includedCheckedBags > 0 ? o.amount : o.amount + (BAG_FEE[o.currency] ?? 75);
}

/** Transfers and time on foot, not raw duration. */
function fatigue(o: duffel.Offer, walkingKm: number): number {
  return Math.round((o.segments - 1) * 12 + o.durationMinutes / 60 + walkingKm * 4);
}

type Option = {
  archetype: "fastest" | "cheapest" | "lowest_stress";
  title: string;
  offerId: string;
  carrier: string;
  amount: number;
  trueCost: number;
  currency: string;
  durationMinutes: number;
  segments: number;
  includedCheckedBags: number;
  holdable: boolean;
  expiresAt: string | null;
  departsAt: string;
  arrivesAt: string;
  walkingMetres: number | null;
  fatigue: number;
  accessibility: {
    level: "yes" | "limited" | "no" | "unknown";
    basis: string;
    caveat: string;
  };
  because: string;
  evidence: Array<{ label: string; value: string; source: string; freshness: string }>;
};

function pick(offers: duffel.Offer[], walking: number | null): Option[] {
  if (!offers.length) return [];
  // Only holdable offers can be protected while the traveller decides, which is
  // the entire promise of this screen. Fall back rather than show nothing.
  const holdable = offers.filter((o) => o.holdable);
  const pool = holdable.length ? holdable : offers;
  const km = (walking ?? 0) / 1000;

  const specs = [
    {
      archetype: "fastest" as const, title: "Fastest",
      offer: pool.reduce((a, b) => (b.durationMinutes < a.durationMinutes ? b : a)),
      why: (o: duffel.Offer) =>
        `${Math.floor(o.durationMinutes / 60)}h${String(o.durationMinutes % 60).padStart(2, "0")} — the shortest journey Duffel returned`
    },
    {
      archetype: "cheapest" as const, title: "Lowest cost",
      offer: pool.reduce((a, b) => (trueCost(b) < trueCost(a) ? b : a)),
      why: (o: duffel.Offer) =>
        o.includedCheckedBags > 0
          ? `${o.currency} ${o.amount} including a checked bag`
          : `${o.currency} ${trueCost(o)} true cost — the ${o.amount} fare carries no bag`
    },
    {
      archetype: "lowest_stress" as const, title: "Lowest stress",
      offer: pool.reduce((a, b) => (fatigue(b, km) < fatigue(a, km) ? b : a)),
      why: (o: duffel.Offer) =>
        `${o.segments === 1 ? "Direct" : `${o.segments - 1} change(s)`}, ${Math.floor(o.durationMinutes / 60)}h${String(o.durationMinutes % 60).padStart(2, "0")}`
    }
  ];

  const rank: Record<string, (o: duffel.Offer) => number> = {
    fastest: (o) => o.durationMinutes,
    cheapest: trueCost,
    lowest_stress: (o) => fatigue(o, km)
  };

  const used = new Set<string>();
  const out: Option[] = [];
  for (const spec of specs) {
    let offer = spec.offer;
    if (used.has(offer.id)) {
      // Re-rank on this archetype's OWN axis. Taking whatever is next in the
      // list would label an arbitrary offer "lowest stress", and a label that
      // does not win its axis is a lie the traveller acts on under pressure.
      const remaining = pool.filter((o) => !used.has(o.id));
      if (!remaining.length) continue;
      const score = rank[spec.archetype];
      offer = remaining.reduce((a, b) => (score(b) < score(a) ? b : a));
    }
    used.add(offer.id);
    out.push({
      archetype: spec.archetype,
      title: spec.title,
      offerId: offer.id,
      carrier: offer.carrier,
      amount: offer.amount,
      trueCost: trueCost(offer),
      currency: offer.currency,
      durationMinutes: offer.durationMinutes,
      segments: offer.segments,
      includedCheckedBags: offer.includedCheckedBags,
      holdable: offer.holdable,
      expiresAt: offer.expiresAt,
      departsAt: offer.departsAt,
      arrivesAt: offer.arrivesAt,
      walkingMetres: walking,
      fatigue: fatigue(offer, km),
      accessibility: {
        // ORS routes a wheelchair PROFILE over map geometry. That is not the
        // same as a verified step-free path, and calling it accessible would be
        // the one claim this product must never make wrongly.
        level: "unknown",
        basis: walking === null
          ? "No routing available for the airport transfer"
          : "openrouteservice wheelchair profile over OpenStreetMap geometry",
        caveat:
          "Wheelchair-profile routing, NOT verified step-free evidence. " +
          "Kerbs, roadworks and broken lifts are frequently unmapped. Unknown is not accessible."
      },
      because: spec.why(offer),
      evidence: [
        { label: "Fare", value: `${offer.currency} ${offer.amount}`, source: "Duffel (sandbox)", freshness: offer.expiresAt ? `valid until ${offer.expiresAt}` : "expiry not stated" },
        { label: "Checked bag", value: offer.includedCheckedBags > 0 ? `${offer.includedCheckedBags} included` : "not included", source: "Duffel offer", freshness: "as returned" },
        { label: "Hold", value: offer.holdable ? "can be held without paying" : "requires instant payment", source: "Duffel payment_requirements", freshness: "as returned" },
        ...(walking !== null
          ? [{ label: "Transfer on foot", value: `${walking} m`, source: "openrouteservice wheelchair profile", freshness: "computed now from OSM" }]
          : [])
      ]
    });
  }
  return out;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const commitmentKey = request.nextUrl.searchParams.get("commitment") ?? "flight";

  try {
    const trip = await getTripById(id);
    if (!trip) return NextResponse.json({ error: "trip not found" }, { status: 404 });

    await A.expireStale();

    const { commitments, dependencies } = await toWorkerPayload(id);
    const broken = commitments.find((c) => c.key === commitmentKey);
    if (!broken) {
      return NextResponse.json({ error: `no commitment "${commitmentKey}" on this trip` }, { status: 404 });
    }

    // The delay comes from the flight provider, not from the caller. A query
    // parameter was fine for a demo and wrong for a product: the whole screen
    // exists because something REALLY went wrong, and taking its magnitude from
    // whoever opened the URL means the rescue is about a disruption nobody
    // observed. The parameter survives only as an override for testing.
    const override = request.nextUrl.searchParams.get("delay");
    let delayMinutes = override ? Number(override) : 0;
    let delaySource = override ? "override (testing)" : "none";

    if (!override) {
      const iata = (broken.label ?? "").replace(/^Flight\s+/i, "").trim();
      if (iata) {
        try {
          const status = await fetch(`${WORKER}/disruption/flight-status`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ flight_iata: iata }),
            signal: AbortSignal.timeout(10_000),
            cache: "no-store"
          });
          if (status.ok) {
            const live = await status.json();
            delayMinutes = Number(live.delay_minutes ?? 0);
            // "live: false" means the provider could not be reached — which is
            // not the same as "the flight is on time", and must not be shown as
            // a healthy journey.
            delaySource = live.live ? "flight provider" : "provider unavailable";
          }
        } catch {
          delaySource = "provider unreachable";
        }
      }
    }
    const cascadeResponse = await fetch(`${WORKER}/journey/cascade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commitments, dependencies, origin: commitmentKey, delay_minutes: delayMinutes }),
      cache: "no-store"
    });
    const cascade = cascadeResponse.ok ? await cascadeResponse.json() : null;

    const existing = await A.activeAction(id, commitmentKey);

    // A settled action is restored exactly as it was. Re-searching would show
    // different prices from the ones the traveller approved.
    if (existing && ["approved", "executing", "verified", "rejected", "expired", "failed"].includes(existing.state)) {
      return NextResponse.json({
        trip: { id, title: trip.title, destination: trip.destination },
        broken, cascade,
        action: existing,
        events: await A.actionEvents(existing.id),
        options: existing.options,
        restored: true,
        providerMode: existing.provider_mode
      });
    }

    const threadId = existing?.thread_id ?? `rescue-${id}-${commitmentKey}-${Date.now()}`;
    const { action } = await A.startAction({ tripId: id, commitmentKey, threadId });

    if (!duffel.isConfigured()) {
      return NextResponse.json({
        trip: { id, title: trip.title, destination: trip.destination },
        broken, cascade, action, events: await A.actionEvents(action.id),
        options: [],
        // An empty list and "we could not look" are different answers.
        unavailable: "DUFFEL_ACCESS_TOKEN is not set — no alternatives could be searched.",
        providerMode: "sandbox"
      });
    }

    // Postgres hands timestamps back as JS Dates; String() on one yields
    // "Tue Aug 04 2026" and slicing it gives "Tue Aug 0", which Duffel rejects
    // with a message about ISO format that says nothing about the cause.
    const departureDate = isoDay(broken.starts) ?? isoDay(new Date())!;
    const route = routeFrom(broken, trip);
    if (!route) {
      return NextResponse.json({
        trip: { id, title: trip.title, destination: trip.destination },
        broken, cascade, action, events: await A.actionEvents(action.id),
        options: [],
        unavailable:
          `Cannot tell which airports "${broken.label}" connects. ` +
          `Alternatives are not shown rather than searched for a guessed route.`,
        providerMode: "sandbox"
      });
    }
    const search = await duffel.searchOffers({
      origin: route.origin, destination: route.destination, departureDate
    });

    if (!search.ok) {
      await A.transition({ actionId: action.id, to: "failed", detail: search.reason, patch: { failure_reason: search.reason } });
      return NextResponse.json({
        trip: { id, title: trip.title, destination: trip.destination },
        broken, cascade,
        action: await A.activeAction(id, commitmentKey),
        events: await A.actionEvents(action.id),
        options: [],
        unavailable: search.reason,
        providerMode: "sandbox"
      });
    }

    // The walking that actually decides feasibility is the ARRIVAL TRANSFER —
    // station to accommodation — not airport to city centre. Routing the latter
    // correctly returns "no step-free route exists" over 25 km of road, which is
    // true and useless: nobody wheels from Heathrow to Westminster.
    //
    // Paddington (where the airport train arrives) to the Kensington stay.
    const leg = await arrivalTransfer(trip.destination ?? "");
    const walkRoute = leg ? await stepFreeRoute(leg) : null;
    const walking = walkRoute?.ok ? walkRoute.distanceMetres : null;

    const options = pick(search.data, walking);
    const soonest = options.map((o) => o.expiresAt).filter(Boolean).sort()[0] ?? null;

    const updated = await A.transition({
      actionId: action.id,
      to: "simulated",
      detail: `${search.data.length} real offers, ${search.data.filter((o) => o.holdable).length} holdable`,
      patch: { options, rollback_deadline: soonest }
    });

    return NextResponse.json({
      trip: { id, title: trip.title, destination: trip.destination },
      broken, cascade,
      action: updated,
      events: await A.actionEvents(action.id),
      options,
      offersSearched: search.data.length,
      delayMinutes,
      delaySource,
      routeUnavailable: walkRoute ? (walkRoute.ok ? null : walkRoute.reason)
                                  : `Could not locate "${trip.destination}" to measure the transfer`,
      searchedRoute: `${route.origin} → ${route.destination}`,
      providerMode: "sandbox",
      restored: false
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "rescue failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const { commitmentKey = "flight", decision, offerId } = body ?? {};

  try {
    const action = await A.activeAction(id, commitmentKey);
    if (!action) return NextResponse.json({ error: "no rescue in progress" }, { status: 404 });

    if (decision === "reject") {
      const updated = await A.transition({
        actionId: action.id, to: "rejected",
        detail: "Traveller declined every alternative"
      });
      return NextResponse.json({ action: updated, events: await A.actionEvents(action.id) });
    }

    if (decision !== "approve") {
      return NextResponse.json({ error: "decision must be approve or reject" }, { status: 400 });
    }

    // A second approval must not hold a second seat.
    if (["approved", "executing", "verified"].includes(action.state)) {
      return NextResponse.json({
        action, events: await A.actionEvents(action.id),
        duplicate: true,
        message: `Already ${action.state}. A second approval does not create a second booking.`
      });
    }

    if (!offerId) return NextResponse.json({ error: "offerId is required to approve" }, { status: 400 });

    const { commitments: cs } = await toWorkerPayload(id);
    const departureDate =
      isoDay(cs.find((c) => c.key === commitmentKey)?.starts) ?? isoDay(new Date())!;

    // Re-price BEFORE committing: an offer that moved books at a number nobody
    // agreed to, and the traveller must see the change rather than absorb it.
    const priced = await duffel.confirmPrice(offerId);
    if (!priced.ok) {
      const updated = await A.transition({
        actionId: action.id, to: "failed",
        detail: `Re-pricing failed: ${priced.reason}`,
        patch: { failure_reason: priced.reason }
      });
      return NextResponse.json({ action: updated, events: await A.actionEvents(action.id), priceCheck: { ok: false, reason: priced.reason } });
    }

    const presented = (action.options as Option[]).find((o) => o.offerId === offerId);
    const moved = presented && presented.amount !== priced.data.amount;

    if (moved) {
      // Do NOT proceed. The traveller approved a number; a different one needs
      // a fresh decision.
      const updated = await A.transition({
        actionId: action.id, to: "priced",
        detail: `Price changed from ${presented!.amount} to ${priced.data.amount} before approval could complete`,
        patch: { amount: priced.data.amount, currency: priced.data.currency, chosen_offer_id: offerId }
      });
      return NextResponse.json({
        action: updated, events: await A.actionEvents(action.id),
        priceChanged: { from: presented!.amount, to: priced.data.amount, currency: priced.data.currency },
        message: "The price moved while you were deciding. Approve again to accept the new price."
      });
    }

    await A.transition({
      actionId: action.id, to: "approved",
      detail: `Traveller approved ${priced.data.currency} ${priced.data.amount}`,
      patch: {
        chosen_offer_id: offerId, amount: priced.data.amount,
        currency: priced.data.currency, approved_by: "traveller",
        rollback_deadline: priced.data.expiresAt
      }
    });

    await A.transition({ actionId: action.id, to: "executing", detail: "Holding the seat with the provider" });

    const passenger = await passengerFor(id);
    if (!passenger) {
      const updated = await A.transition({
        actionId: action.id, to: "failed",
        detail: "No usable traveller name on the account; a hold cannot be made under a placeholder",
        patch: {
          failure_reason:
            "The airline matches the passenger name against your travel document. " +
            "Add your full name to your account before holding a seat."
        }
      });
      return NextResponse.json({ action: updated, events: await A.actionEvents(action.id) });
    }

    const held = await duffel.holdOrder(priced.data, {
      given_name: passenger.given_name,
      family_name: passenger.family_name,
      // Duffel requires a date of birth; it is not on the account yet, so this
      // is a documented placeholder rather than a silent invention. Collecting
      // it belongs in the traveller profile, not here.
      born_on: "1990-01-01",
      email: passenger.email,
      phone_number: "+442080160509"
    });

    if (!held.ok) {
      // Duffel answers an EXPIRED offer with "The specified `type` was
      // incorrect", which tells the traveller nothing and sounds like our bug.
      // An offer that lapsed while someone was deciding is a normal event on
      // this screen and deserves a re-search, not an error.
      const expired = /type` was incorrect|offer.*(expired|no longer)/i.test(held.reason);
      if (expired) {
        const freshRoute = routeFrom(
          cs.find((c) => c.key === commitmentKey) ?? {}, { destination: "" }
        );
        const fresh = freshRoute
          ? await duffel.searchOffers({
              origin: freshRoute.origin, destination: freshRoute.destination, departureDate
            })
          : { ok: false as const, reason: "route unknown", retryable: false };
        if (fresh.ok && fresh.data.length) {
          const refreshed = pick(fresh.data, null);
          const updated = await A.transition({
            actionId: action.id, to: "simulated",
            detail: "The chosen option expired while you were deciding; prices refreshed",
            patch: { options: refreshed, chosen_offer_id: null }
          });
          return NextResponse.json({
            action: updated,
            events: await A.actionEvents(action.id),
            options: refreshed,
            expired: true,
            message:
              "That option expired before the airline could hold it. " +
              "These are fresh prices — choose again."
          });
        }
      }

      const updated = await A.transition({
        actionId: action.id, to: "failed",
        detail: `Provider refused the hold: ${held.reason}`,
        patch: { failure_reason: held.reason }
      });
      return NextResponse.json({ action: updated, events: await A.actionEvents(action.id) });
    }

    // Verified means the PROVIDER issued a reference, not that we think it
    // worked. This is the only thing that may turn a Pulse node purple.
    const verified = await A.transition({
      actionId: action.id, to: "verified",
      detail: `Provider confirmed reference ${held.data.bookingReference}`,
      patch: {
        provider_order_id: held.data.orderId,
        provider_reference: held.data.bookingReference,
        rollback_deadline: held.data.payBy
      }
    });

    return NextResponse.json({
      action: verified,
      events: await A.actionEvents(action.id),
      protectedNow: A.isProtected(verified)
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "approval failed" },
      { status: 500 }
    );
  }
}
