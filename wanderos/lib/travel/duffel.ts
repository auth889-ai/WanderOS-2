/**
 * Duffel — real flight inventory, and the honest edges around it.
 *
 * This is what turns Recovery Theatre from an illustration into a product. The
 * options it scores were previously hand-built; now they are 50+ real offers
 * from real carriers at real prices.
 *
 * Two things the docs make clear and that most integrations get wrong:
 *
 * **Holds are not available on every airline.** Duffel exposes hold-order flow,
 * but `payment_requirements` decides per-offer whether you may hold or must pay
 * immediately. Presenting "we'll hold this for you" on an offer that cannot be
 * held is a promise the product cannot keep, so hold-ability is read from the
 * offer rather than assumed.
 *
 * **Offers expire.** Every offer carries `expires_at`, and an expired offer
 * fails at booking with a confusing error. That timestamp becomes the
 * rollback deadline the traveller actually sees.
 *
 * Booking is gated twice on purpose: behind the graph's approval interrupt AND
 * behind DUFFEL_ALLOW_BOOKING. A test token can create real orders, and a stray
 * call during a demo should not be able to book a flight.
 */

const BASE = process.env.DUFFEL_API_BASE_URL || "https://api.duffel.com";
const VERSION = process.env.DUFFEL_API_VERSION || "v2";

export type Offer = {
  id: string;
  carrier: string;
  carrierIata: string;
  amount: number;
  currency: string;
  departsAt: string;
  arrivesAt: string;
  durationMinutes: number;
  segments: number;
  /** Free checked bag on the cheapest fare? Drives true cost, not headline. */
  includedCheckedBags: number;
  cabinClass: string;
  /** Whether Duffel will let us hold this without paying. */
  holdable: boolean;
  /** After this, the price is no longer valid. The rollback deadline. */
  expiresAt: string | null;
  origin: string;
  destination: string;
  /** Duffel mints this inside the offer request. A hold MUST reuse it —
   *  inventing an id fails with "linked record(s) not found". */
  passengerIds: string[];
};

export type DuffelResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string; retryable: boolean };

export function isConfigured(): boolean {
  return Boolean(process.env.DUFFEL_ACCESS_TOKEN);
}

/** Booking is off unless deliberately enabled. A test token books real orders. */
export function bookingEnabled(): boolean {
  return process.env.DUFFEL_ALLOW_BOOKING === "true";
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.DUFFEL_ACCESS_TOKEN}`,
    "Duffel-Version": VERSION,
    Accept: "application/json",
    "Content-Type": "application/json"
  };
}

async function call<T>(
  path: string,
  init?: RequestInit,
  timeoutMs = 90_000
): Promise<DuffelResult<T>> {
  if (!isConfigured()) {
    return { ok: false, reason: "DUFFEL_ACCESS_TOKEN is not set", retryable: false };
  }
  try {
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: headers(),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store"
    });

    if (!response.ok) {
      const body = await response.text();
      let detail = body.slice(0, 200);
      try {
        const parsed = JSON.parse(body);
        detail = parsed.errors?.[0]?.message ?? parsed.errors?.[0]?.title ?? detail;
      } catch {
        /* keep the raw body — an unparseable error is still information */
      }
      return {
        ok: false,
        reason: `Duffel ${response.status}: ${detail}`,
        // 429 and 5xx are worth retrying; a 422 means the request itself is wrong.
        retryable: response.status === 429 || response.status >= 500
      };
    }
    return { ok: true, data: (await response.json()).data as T };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: message, retryable: true };
  }
}

function minutesBetween(from: string, to: string): number {
  return Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60000));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toOffer(raw: any): Offer | null {
  const slice = raw?.slices?.[0];
  const segments = slice?.segments ?? [];
  if (!segments.length) return null;

  const first = segments[0];
  const last = segments[segments.length - 1];

  // Baggage lives on the passenger entry of each segment, not the offer. A
  // headline fare without a bag is not comparable to one with a bag included —
  // this is the "true cost" distinction the strategy doc keeps insisting on.
  const bags = Number(
    first?.passengers?.[0]?.baggages?.find((b: any) => b.type === "checked")?.quantity ?? 0
  );

  return {
    id: raw.id,
    carrier: raw.owner?.name ?? "Unknown carrier",
    carrierIata: raw.owner?.iata_code ?? "",
    amount: Number(raw.total_amount),
    currency: raw.total_currency,
    departsAt: first.departing_at,
    arrivesAt: last.arriving_at,
    durationMinutes: minutesBetween(first.departing_at, last.arriving_at),
    segments: segments.length,
    includedCheckedBags: bags,
    cabinClass: first?.passengers?.[0]?.cabin_class ?? "economy",
    // `instant` means pay now; anything else means a hold is possible.
    holdable: raw.payment_requirements?.requires_instant_payment === false,
    expiresAt: raw.expires_at ?? null,
    origin: first.origin?.iata_code ?? "",
    destination: last.destination?.iata_code ?? "",
    passengerIds: (raw.passengers ?? []).map((p: any) => p.id).filter(Boolean)
  };
}

export async function searchOffers(params: {
  origin: string;
  destination: string;
  departureDate: string;
  adults?: number;
  cabinClass?: string;
  limit?: number;
}): Promise<DuffelResult<Offer[]>> {
  const result = await call<any>("/air/offer_requests?return_offers=true", {
    method: "POST",
    body: JSON.stringify({
      data: {
        slices: [
          {
            origin: params.origin,
            destination: params.destination,
            departure_date: params.departureDate
          }
        ],
        passengers: Array.from({ length: params.adults ?? 1 }, () => ({ type: "adult" })),
        cabin_class: params.cabinClass ?? "economy"
      }
    })
  });

  if (!result.ok) return result;

  const offers = (result.data.offers ?? [])
    .map(toOffer)
    .filter((o: Offer | null): o is Offer => o !== null)
    .slice(0, params.limit ?? 60);

  return { ok: true, data: offers };
}

/** Re-price before committing. A stale offer books at a price nobody agreed to. */
export async function confirmPrice(offerId: string): Promise<DuffelResult<Offer>> {
  const result = await call<any>(`/air/offers/${offerId}?return_available_services=false`);
  if (!result.ok) return result;
  const offer = toOffer(result.data);
  return offer
    ? { ok: true, data: offer }
    : { ok: false, reason: "offer no longer has segments", retryable: false };
}

export type HoldResult = {
  orderId: string;
  bookingReference: string;
  /** Pay by this or the hold lapses. Shown to the traveller, never implied. */
  payBy: string | null;
  amount: number;
  currency: string;
};

/**
 * Hold a seat WITHOUT paying.
 *
 * This is the state that makes the whole flow safe: the traveller gets time to
 * decide while the price and seat are protected, and nothing irreversible has
 * happened. Where the airline does not support it, that is reported rather than
 * worked around.
 */
export async function holdOrder(
  offer: Offer,
  passenger: { given_name: string; family_name: string; born_on: string; email: string; phone_number: string }
): Promise<DuffelResult<HoldResult>> {
  const passengerId = offer.passengerIds[0];
  if (!passengerId) {
    return {
      ok: false,
      reason: "offer carries no passenger id; cannot hold without it",
      retryable: false
    };
  }
  const result = await call<any>("/air/orders", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "hold",
        selected_offers: [offer.id],
        passengers: [
          {
            id: passengerId,
            title: "mr",
            gender: "m",
            given_name: passenger.given_name,
            family_name: passenger.family_name,
            born_on: passenger.born_on,
            email: passenger.email,
            phone_number: passenger.phone_number
          }
        ]
      }
    })
  });

  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      orderId: result.data.id,
      bookingReference: result.data.booking_reference,
      payBy: result.data.payment_status?.payment_required_by ?? null,
      amount: Number(result.data.total_amount),
      currency: result.data.total_currency
    }
  };
}

/**
 * Pay for a held order — the only irreversible step.
 *
 * Refuses unless DUFFEL_ALLOW_BOOKING is explicitly "true". A test token can
 * create real orders, and no demo should be able to spend money by accident.
 */
export async function payForOrder(
  orderId: string,
  amount: number,
  currency: string
): Promise<DuffelResult<{ paid: true }>> {
  if (!bookingEnabled()) {
    return {
      ok: false,
      reason:
        "Booking is disabled. Set DUFFEL_ALLOW_BOOKING=true to permit real orders. " +
        "This guard exists because a test token creates real orders.",
      retryable: false
    };
  }
  const result = await call<any>("/air/payments", {
    method: "POST",
    body: JSON.stringify({
      data: {
        order_id: orderId,
        payment: { type: "balance", amount: String(amount), currency }
      }
    })
  });
  return result.ok ? { ok: true, data: { paid: true } } : result;
}

/** Cancel a held order — what makes the hold genuinely reversible. */
export async function cancelOrder(orderId: string): Promise<DuffelResult<{ cancelled: true }>> {
  const result = await call<any>(`/air/order_cancellations`, {
    method: "POST",
    body: JSON.stringify({ data: { order_id: orderId } })
  });
  if (!result.ok) return result;
  const confirm = await call<any>(`/air/order_cancellations/${result.data.id}/actions/confirm`, {
    method: "POST",
    body: JSON.stringify({})
  });
  return confirm.ok ? { ok: true, data: { cancelled: true } } : confirm;
}


export type OrderDetail = {
  reference: string;
  orderId: string;
  status: "held" | "paid";
  payBy: string | null;
  amount: number;
  currency: string;
  passenger: string;
  segments: Array<{
    carrier: string;
    carrierIata: string;
    flightNumber: string;
    from: string;
    fromName: string;
    fromTerminal: string | null;
    to: string;
    toName: string;
    toTerminal: string | null;
    departsAt: string;
    arrivesAt: string;
    aircraft: string | null;
    cabin: string;
  }>;
  conditions: { changeable: boolean | null; refundable: boolean | null };
  cancellable: boolean;
  /** The airline's own manage-booking page. The PNR is entered THERE — Duffel
   *  is a B2B API and issues no consumer link of its own, in sandbox or live. */
  manageUrl: string | null;
};

/** Where a passenger actually uses their reference. */
const MANAGE_URLS: Record<string, string> = {
  BA: "https://www.britishairways.com/travel/managebooking/public/en_gb",
  AA: "https://www.aa.com/reservation/view/find-your-trip",
  EK: "https://www.emirates.com/manage-booking/",
  IB: "https://www.iberia.com/gb/manage-booking/",
  AF: "https://wwws.airfrance.co.uk/manage-booking",
  KL: "https://www.klm.co.uk/trip/manage",
  LH: "https://www.lufthansa.com/gb/en/manage-booking",
  AT: "https://www.royalairmaroc.com/uk-en/Manage-booking",
  QR: "https://www.qatarairways.com/en/manage-booking.html",
  TK: "https://www.turkishairlines.com/en-int/flights/manage-booking/"
};

/**
 * Fetch an order back from the provider.
 *
 * This is what makes a held seat inspectable rather than a claim: the segments,
 * terminals and conditions all come from the airline via Duffel at read time,
 * so a schedule change shows up here without anything being re-saved.
 */
export async function getOrder(orderId: string): Promise<DuffelResult<OrderDetail>> {
  const result = await call<any>(`/air/orders/${orderId}`);
  if (!result.ok) return result;

  const d = result.data;
  const segments = (d.slices ?? []).flatMap((slice: any) =>
    (slice.segments ?? []).map((seg: any) => ({
      carrier: seg.marketing_carrier?.name ?? "",
      carrierIata: seg.marketing_carrier?.iata_code ?? "",
      flightNumber: `${seg.marketing_carrier?.iata_code ?? ""}${seg.marketing_carrier_flight_number ?? ""}`,
      from: seg.origin?.iata_code ?? "",
      fromName: seg.origin?.name ?? "",
      fromTerminal: seg.origin_terminal ?? null,
      to: seg.destination?.iata_code ?? "",
      toName: seg.destination?.name ?? "",
      toTerminal: seg.destination_terminal ?? null,
      departsAt: seg.departing_at,
      arrivesAt: seg.arriving_at,
      aircraft: seg.aircraft?.name ?? null,
      cabin: seg.passengers?.[0]?.cabin_class ?? "economy"
    }))
  );

  const owner = d.owner?.iata_code ?? segments[0]?.carrierIata ?? "";
  const passengerName = d.passengers?.[0]
    ? `${d.passengers[0].given_name ?? ""} ${d.passengers[0].family_name ?? ""}`.trim()
    : "";

  return {
    ok: true,
    data: {
      reference: d.booking_reference,
      orderId: d.id,
      status: d.payment_status?.awaiting_payment ? "held" : "paid",
      payBy: d.payment_status?.payment_required_by ?? null,
      amount: Number(d.total_amount),
      currency: d.total_currency,
      passenger: passengerName,
      segments,
      conditions: {
        changeable: d.conditions?.change_before_departure?.allowed ?? null,
        refundable: d.conditions?.refund_before_departure?.allowed ?? null
      },
      cancellable: (d.available_actions ?? []).includes("cancel"),
      manageUrl: MANAGE_URLS[owner] ?? null
    }
  };
}
