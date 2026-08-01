/**
 * Deterministic extraction — the tiers that need no model at all.
 *
 * Following KDE/kitinerary, the production system for this problem: travel
 * confirmations very often carry machine-readable data already, and reaching
 * for a language model before checking is strictly worse. An LLM guessing at a
 * departure time that was sitting in JSON-LD three lines above is slower,
 * costlier, and less accurate than reading it.
 *
 *   Tier 1  schema.org JSON-LD    airlines embed this so Gmail can parse it
 *   Tier 2  IATA BCBP barcode     the boarding pass itself is structured data
 *
 * Only when both are absent does anything reach Textract or Bedrock.
 *
 * **Timezones are explicit, following kitinerary's hardest-won lesson.** They
 * extend schema.org with IANA zones because a bare local datetime is ambiguous,
 * and a flight time interpreted in the wrong zone is a missed flight. Where a
 * confirmation gives no offset, that is recorded as unknown rather than assumed
 * to be the reader's own timezone — which is how a 21:10 arrival in Dubai
 * quietly becomes 21:10 in London.
 */

/** Which tier produced a fact. A date from JSON-LD and a date guessed by a
 *  model are not the same fact, and the twin ranks sources for this reason. */
export type ExtractionTier = "json-ld" | "barcode" | "ocr" | "model" | "none";

export type ExtractedSegment = {
  kind: "flight" | "lodging" | "train" | "unknown";
  reference: string | null;
  carrier: string | null;
  number: string | null;
  from: string | null;
  to: string | null;
  /** ISO 8601. Carries an offset only when the source actually gave one. */
  departsAt: string | null;
  arrivesAt: string | null;
  /** True when the timestamps above have no zone and must not be trusted
   *  as absolute times. */
  timezoneUnknown: boolean;
  passenger: string | null;
  seat: string | null;
  tier: ExtractionTier;
  confidence: number;
};

/* ── Tier 1: schema.org JSON-LD ─────────────────────────────────────────── */

const RESERVATION_TYPES = new Set([
  "FlightReservation",
  "LodgingReservation",
  "TrainReservation",
  "BusReservation"
]);

function typeToKind(type: string): ExtractedSegment["kind"] {
  if (type === "FlightReservation") return "flight";
  if (type === "LodgingReservation") return "lodging";
  if (type === "TrainReservation") return "train";
  return "unknown";
}

/** An ISO datetime is zone-qualified only if it ends in Z or ±HH:MM. */
export function hasTimezone(iso: string | null | undefined): boolean {
  if (!iso) return false;
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso.trim());
}

/**
 * Walk arbitrarily nested JSON-LD.
 *
 * Reservations arrive inside @graph arrays, inside itemListElement, or as bare
 * objects depending on who sent the email. Recursing is far more robust than
 * guessing the envelope shape.
 */
function* walk(node: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(node)) {
    for (const child of node) yield* walk(child);
    return;
  }
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    yield record;
    for (const value of Object.values(record)) yield* walk(value);
  }
}

export function extractJsonLd(html: string): ExtractedSegment[] {
  const blocks = [...html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )].map((m) => m[1]);

  const found: ExtractedSegment[] = [];

  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block.trim());
    } catch {
      // A malformed block is skipped, not fatal — one bad script tag must not
      // discard the reservation in the next one.
      continue;
    }

    for (const node of walk(parsed)) {
      const type = String(node["@type"] ?? "");
      if (!RESERVATION_TYPES.has(type)) continue;

      const forRaw = node.reservationFor;
      const target = (Array.isArray(forRaw) ? forRaw[0] : forRaw) as
        | Record<string, unknown>
        | undefined;

      const depart =
        (target?.departureTime as string) ?? (target?.checkinTime as string) ?? null;
      const arrive =
        (target?.arrivalTime as string) ?? (target?.checkoutTime as string) ?? null;

      const airline = target?.airline as Record<string, unknown> | undefined;
      const provider = node.provider as Record<string, unknown> | undefined;
      const person = node.underName as Record<string, unknown> | undefined;

      const place = (key: string) => {
        const p = target?.[key] as Record<string, unknown> | undefined;
        return (p?.iataCode as string) ?? (p?.name as string) ?? null;
      };

      found.push({
        kind: typeToKind(type),
        reference: (node.reservationNumber as string) ?? null,
        carrier:
          (airline?.name as string) ??
          (airline?.iataCode as string) ??
          (provider?.name as string) ??
          ((target?.name as string) || null),
        number: (target?.flightNumber as string) ?? (target?.trainNumber as string) ?? null,
        from: place("departureAirport") ?? place("departureStation") ?? null,
        to:
          place("arrivalAirport") ??
          place("arrivalStation") ??
          ((target?.name as string) || null),
        departsAt: depart,
        arrivesAt: arrive,
        // kitinerary's lesson: a bare local time is not an instant.
        timezoneUnknown: Boolean(depart) && !hasTimezone(depart),
        passenger: (person?.name as string) ?? null,
        seat:
          ((node.reservedTicket as Record<string, unknown>)?.ticketedSeat as
            | Record<string, unknown>
            | undefined)?.seatNumber as string ?? null,
        tier: "json-ld",
        // The sender published this deliberately for machines to read. It is
        // the strongest signal available short of the airline's own API.
        confidence: 0.97
      });
    }
  }
  return found;
}

/* ── Tier 2: IATA BCBP (boarding pass barcode) ──────────────────────────── */

/**
 * IATA Resolution 792 fixed layout. Field positions are fixed by the spec,
 * which is what makes this deterministic rather than a heuristic:
 *
 *   M1SMITH/JOHN          EABC123 LHRJFKBA 0117 226Y012A0050 100
 *   ^ ^                   ^       ^  ^  ^  ^    ^  ^
 *   | passenger           PNR     from to carrier flight  julian-day cabin seat
 *   format code
 *
 * The Julian day carries no year — the spec simply does not include one. We
 * resolve it against a reference date rather than assuming the current year,
 * because a pass scanned on 2 January for a 30 December flight would otherwise
 * jump twelve months.
 */
/**
 * Fixed offsets from IATA Resolution 792. The spec defines positions, not
 * delimiters, so slicing by offset is both more correct and more legible than
 * one long regular expression — and a field that shifts by a character (as the
 * electronic-ticket indicator does) fails loudly here instead of silently
 * capturing its neighbour.
 */
const BCBP_FIELDS = {
  formatCode: [0, 1],
  legs: [1, 2],
  name: [2, 22],
  eTicketIndicator: [22, 23],
  pnr: [23, 30],
  from: [30, 33],
  to: [33, 36],
  carrier: [36, 39],
  flightNumber: [39, 44],
  julianDate: [44, 47],
  compartment: [47, 48],
  seat: [48, 52],
  sequence: [52, 57]
} as const;

export function extractBoardingPass(
  raw: string,
  reference = new Date()
): ExtractedSegment | null {
  const text = raw.trim();
  // A conditional-items section may follow, so the pass is at LEAST this long.
  if (text.length < 57 || text[0] !== "M" || !/\d/.test(text[1])) return null;

  const field = (name: keyof typeof BCBP_FIELDS) => {
    const [start, end] = BCBP_FIELDS[name];
    return text.slice(start, end).trim();
  };

  const nameRaw = field("name");
  const pnrRaw = field("pnr");
  const from = field("from");
  const to = field("to");
  const carrierRaw = field("carrier");
  const flightRaw = field("flightNumber");
  const seatRaw = field("seat");

  // Airport codes are three letters by definition; anything else means the
  // offsets have not landed where the spec says and the read is not trustworthy.
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return null;

  const julian = Number(field("julianDate"));
  if (!Number.isFinite(julian) || julian < 1 || julian > 366) return null;

  // Resolve the year: pick whichever candidate lands nearest the reference
  // date. A pass read in January for day 364 belongs to the year just ended.
  const candidates = [reference.getUTCFullYear() - 1, reference.getUTCFullYear(), reference.getUTCFullYear() + 1]
    .map((year) => {
      const d = new Date(Date.UTC(year, 0, 1));
      d.setUTCDate(julian);
      return d;
    });
  const departure = candidates.reduce((best, d) =>
    Math.abs(d.getTime() - reference.getTime()) < Math.abs(best.getTime() - reference.getTime()) ? d : best
  );

  const name = nameRaw.trim().replace(/\s+/g, " ");
  const seat = seatRaw.trim().replace(/^0+/, "");

  return {
    kind: "flight",
    reference: pnrRaw.trim() || null,
    carrier: carrierRaw.trim() || null,
    number: `${carrierRaw.trim()}${flightRaw.trim().replace(/^0+/, "")}`,
    from,
    to,
    // The barcode gives a DATE and no time at all. Emitting midnight as if it
    // were a departure time would be inventing precision the spec never had.
    departsAt: departure.toISOString().slice(0, 10),
    arrivesAt: null,
    timezoneUnknown: true,
    passenger: name || null,
    seat: seat || null,
    tier: "barcode",
    // Structurally exact, but date-only and year-inferred.
    confidence: 0.9
  };
}

/* ── merge ──────────────────────────────────────────────────────────────── */

/** Same journey seen by two tiers? Match on the things that cannot coincide. */
function sameSegment(a: ExtractedSegment, b: ExtractedSegment): boolean {
  if (a.reference && b.reference && a.reference === b.reference) return true;
  return Boolean(
    a.from && a.to && a.from === b.from && a.to === b.to &&
    a.departsAt?.slice(0, 10) === b.departsAt?.slice(0, 10)
  );
}

/**
 * Combine tiers, strongest first — and fill gaps rather than overwrite.
 *
 * A barcode knows the seat; JSON-LD knows the arrival time. Letting the higher
 * tier win outright would throw away facts only the lower tier has, which is
 * the opposite of what a fallback ladder is for.
 */
export function mergeSegments(...groups: ExtractedSegment[][]): ExtractedSegment[] {
  const order: Record<ExtractionTier, number> = {
    "json-ld": 0, barcode: 1, ocr: 2, model: 3, none: 4
  };
  const all = groups.flat().sort((a, b) => order[a.tier] - order[b.tier]);
  const merged: ExtractedSegment[] = [];

  for (const segment of all) {
    const existing = merged.find((m) => sameSegment(m, segment));
    if (!existing) {
      merged.push({ ...segment });
      continue;
    }
    for (const key of Object.keys(segment) as (keyof ExtractedSegment)[]) {
      if (key === "tier" || key === "confidence" || key === "timezoneUnknown") continue;
      if (existing[key] == null && segment[key] != null) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (existing as any)[key] = segment[key];
      }
    }
    // If the winning tier lacked a zone but a weaker one supplied a qualified
    // timestamp, the ambiguity is genuinely resolved.
    if (existing.timezoneUnknown && hasTimezone(segment.departsAt)) {
      existing.departsAt = segment.departsAt;
      existing.timezoneUnknown = false;
    }
  }
  return merged;
}
