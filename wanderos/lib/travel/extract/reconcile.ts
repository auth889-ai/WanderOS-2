/**
 * Reconciliation — deciding what an arriving confirmation MEANS.
 *
 * The same booking arrives many times: the original, the forward, the airline's
 * schedule-change notice, the cancellation. Treating each as new produces a
 * duplicated itinerary; treating each as an update lets a stale forward
 * overwrite a newer change. Both are silent, and both strand someone.
 *
 * So an arrival is classified before anything is written:
 *
 *   new           nothing like this is on the trip
 *   duplicate     same booking, nothing has changed — ignore
 *   update        same booking, something material moved
 *   cancellation  the sender says it is off
 *
 * **Nothing overwrites silently.** An update produces a diff for review, not a
 * write. The Journey Twin ranks sources for a reason: a traveller's own
 * correction outranks an OCR read, and a model inference must never quietly
 * replace a fact the airline stated.
 *
 * **Five things always force review**, because each one is wrong in a way the
 * traveller cannot see downstream: an inferred year, an unqualified timezone,
 * an unresolved airport, a hard deadline, and refundability. Those are exactly
 * the fields the cascade engine uses to decide whether a delay costs money.
 */

import type { ExtractedSegment } from "./structured";

export type Classification = "new" | "duplicate" | "update" | "cancellation";

export type ExistingCommitment = {
  key: string;
  label: string;
  kind: string;
  starts_at: string | null;
  value: number | null;
  currency: string;
  refundable: boolean;
  hard_deadline: string | null;
  source: string;
  confidence: number;
  reference?: string | null;
};

export type FieldChange = {
  field: string;
  from: unknown;
  to: unknown;
  /** True when the incoming source is weaker than what is already stored. */
  wouldDowngrade: boolean;
};

export type ReviewReason =
  | "inferred_year"
  | "unqualified_timezone"
  | "unresolved_airport"
  | "hard_deadline"
  | "refundability"
  | "low_confidence"
  | "downgrade";

export type Reconciliation = {
  classification: Classification;
  matchedKey: string | null;
  changes: FieldChange[];
  reviewReasons: ReviewReason[];
  requiresReview: boolean;
  /** Plain sentence a human can act on without reading the diff. */
  summary: string;
};

/** Source strength, matching the Journey Twin's ladder exactly. */
const SOURCE_RANK: Record<string, number> = {
  assumed: 0,
  inferred: 1,
  third_party: 2,
  measured: 3,
  traveller: 4,
  official: 5
};

/** Which extraction tier maps to which twin source. */
const TIER_SOURCE: Record<string, string> = {
  "json-ld": "official", // the carrier published it for machines to read
  barcode: "official", // the boarding pass itself
  ocr: "third_party", // a good read of what was printed
  model: "inferred", // a plausible reading of prose
  none: "assumed"
};

const CANCELLED = /\b(cancell?ed|cancellation confirm|your booking has been cancelled|refund(?:ed)? in full|no longer valid|booking void)\b/i;

const AIRPORT_CODE = /^[A-Z]{3}$/;

function normaliseReference(value: string | null | undefined): string {
  return (value ?? "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

/**
 * Does this arrival describe a booking already on the trip?
 *
 * Reference first — it is the only identifier the sender guarantees. Falling
 * back to route+date matters because a forwarded email often loses the
 * reference in quoting, and a booking matched on nothing becomes a duplicate
 * itinerary entry.
 */
function findMatch(
  segment: ExtractedSegment,
  existing: ExistingCommitment[]
): ExistingCommitment | null {
  const reference = normaliseReference(segment.reference);
  if (reference) {
    const byReference = existing.find(
      (e) => normaliseReference(e.reference) === reference
    );
    if (byReference) return byReference;
  }

  const day = segment.departsAt?.slice(0, 10);
  if (!day) return null;

  return (
    existing.find(
      (e) =>
        e.starts_at?.slice(0, 10) === day &&
        (segment.number
          ? (e.label ?? "").toUpperCase().includes(segment.number.toUpperCase())
          : e.kind === (segment.kind === "lodging" ? "stay" : segment.kind))
    ) ?? null
  );
}

/** Material differences only. A reformatted string is not a schedule change. */
function diff(
  segment: ExtractedSegment,
  existing: ExistingCommitment,
  incomingSource: string
): FieldChange[] {
  const changes: FieldChange[] = [];
  const wouldDowngrade =
    (SOURCE_RANK[incomingSource] ?? 0) < (SOURCE_RANK[existing.source] ?? 0);

  const compare = (field: string, from: unknown, to: unknown) => {
    if (to == null || to === "") return; // absence is not a change
    const same =
      field.endsWith("At") || field === "hard_deadline"
        ? String(from ?? "").slice(0, 16) === String(to).slice(0, 16)
        : String(from ?? "").trim() === String(to).trim();
    if (!same) changes.push({ field, from: from ?? null, to, wouldDowngrade });
  };

  compare("starts_at", existing.starts_at, segment.departsAt);

  // A label difference is almost never a change worth reviewing. "Hotel Ocean
  // View" against a stored "Hotel Ocean View check-in" is the same booking
  // described two ways, and treating it as an update sends every duplicate
  // resend to a human — which trains them to approve without reading.
  if (segment.carrier) {
    const stored = (existing.label ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const incoming = segment.carrier.toLowerCase().replace(/[^a-z0-9]/g, "");
    const related = stored.includes(incoming) || incoming.includes(stored);
    if (!related) {
      changes.push({ field: "label", from: existing.label, to: segment.carrier, wouldDowngrade });
    }
  }
  return changes;
}

/**
 * Which fields cannot be trusted without a human looking.
 *
 * Each of these is wrong in a way that is invisible downstream — the cascade
 * engine will happily compute an expected loss from a refundability flag a
 * model guessed at, and present it with full confidence.
 */
function reviewReasons(
  segment: ExtractedSegment,
  terms: { refundable?: boolean | null; hardDeadline?: string | null } | undefined,
  changes: FieldChange[]
): ReviewReason[] {
  const reasons = new Set<ReviewReason>();

  // A model that supplies a year the email never stated is confidently wrong
  // by whole years; extract/model.ts caps confidence at 0.4 when it does.
  if (segment.tier === "model" && segment.confidence <= 0.4) reasons.add("inferred_year");

  if (segment.departsAt && segment.timezoneUnknown) reasons.add("unqualified_timezone");

  for (const code of [segment.from, segment.to]) {
    if (code && code.length <= 4 && !AIRPORT_CODE.test(code)) reasons.add("unresolved_airport");
  }

  // Both of these decide whether a disruption costs money. Neither may be
  // committed on a model's word.
  if (terms?.hardDeadline) reasons.add("hard_deadline");
  if (terms?.refundable != null && segment.tier === "model") reasons.add("refundability");

  if (segment.confidence < 0.6) reasons.add("low_confidence");
  if (changes.some((c) => c.wouldDowngrade)) reasons.add("downgrade");

  return [...reasons];
}

export function reconcile(
  segment: ExtractedSegment,
  existing: ExistingCommitment[],
  options: {
    rawText?: string;
    terms?: { refundable?: boolean | null; hardDeadline?: string | null };
  } = {}
): Reconciliation {
  const incomingSource = TIER_SOURCE[segment.tier] ?? "inferred";
  const match = findMatch(segment, existing);

  // Cancellation is decided by the message, not the booking. A cancellation
  // notice for something we never saw is still a cancellation, and silently
  // treating it as a new booking would ADD the trip the sender just called off.
  if (options.rawText && CANCELLED.test(options.rawText)) {
    return {
      classification: "cancellation",
      matchedKey: match?.key ?? null,
      changes: [],
      // Never auto-remove. A quoted "your booking has been cancelled" inside a
      // forwarded thread would otherwise delete a live booking.
      reviewReasons: ["low_confidence"],
      requiresReview: true,
      summary: match
        ? `This message says "${match.label}" is cancelled. Nothing has been removed — confirm first.`
        : "This looks like a cancellation for a booking that is not on this trip."
    };
  }

  if (!match) {
    const reasons = reviewReasons(segment, options.terms, []);
    return {
      classification: "new",
      matchedKey: null,
      changes: [],
      reviewReasons: reasons,
      requiresReview: reasons.length > 0,
      summary: `New ${segment.kind} booking${segment.reference ? ` (${segment.reference})` : ""}.`
    };
  }

  const changes = diff(segment, match, incomingSource);
  if (!changes.length) {
    return {
      classification: "duplicate",
      matchedKey: match.key,
      changes: [],
      reviewReasons: [],
      requiresReview: false,
      summary: `Already on this trip as "${match.label}". Nothing changed.`
    };
  }

  const reasons = reviewReasons(segment, options.terms, changes);
  return {
    classification: "update",
    matchedKey: match.key,
    changes,
    // An update ALWAYS goes to review. A schedule change is exactly the moment
    // a wrong write does the most damage, and the traveller is the only one who
    // knows whether this email is the newest.
    reviewReasons: reasons.length ? reasons : ["low_confidence"],
    requiresReview: true,
    summary:
      `"${match.label}" has changed: ` +
      changes.map((c) => `${c.field} ${c.from ?? "—"} → ${c.to}`).join("; ") +
      (changes.some((c) => c.wouldDowngrade)
        ? ` (the stored value came from a stronger source — ${match.source})`
        : "")
  };
}
