/**
 * Tier 4 — AWS Bedrock, for the emails that carry no structure at all.
 *
 * Most confirmations are not machine-readable. A hotel replies in prose, a
 * small carrier sends a plain-text block, a friend forwards a screenshot
 * caption. Tiers 1 and 2 return nothing for those, and this is what runs.
 *
 * It is deliberately LAST. When an airline has published JSON-LD, asking a
 * model to guess at the same departure time is slower, costlier and less
 * accurate than reading it. But when nothing is published, a model is the only
 * thing that can read "we look forward to welcoming you on the 4th" — and that
 * is most of the world's travel email.
 *
 * **Every field it produces is marked `tier: "model"` and capped below the
 * deterministic tiers.** The Journey Twin ranks sources, so an inference can
 * never silently outrank a fact the airline itself stated. That ranking is the
 * only reason it is safe to let a model near this data at all.
 *
 * Reasoning runs on Bedrock — Claude via inference profiles, in BEDROCK_REGION.
 */

import { z } from "zod";

import { invokeStructured } from "@/lib/ai/structured";

import { hasTimezone, type ExtractedSegment } from "./structured";

const SegmentSchema = z.object({
  kind: z.enum(["flight", "lodging", "train", "unknown"]),
  reference: z.string().nullable(),
  carrier: z.string().nullable(),
  number: z.string().nullable(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  departsAt: z.string().nullable(),
  arrivesAt: z.string().nullable(),
  passenger: z.string().nullable(),
  seat: z.string().nullable(),
  /** Cancellation terms decide whether a missed booking costs money — the
   *  cascade engine needs this and no other extractor supplies it. */
  refundable: z.boolean().nullable(),
  amount: z.number().nullable(),
  currency: z.string().nullable(),
  /** "Reception closes at 23:00" — the line that strands people. */
  hardDeadline: z.string().nullable(),
  /** The model's own read on how clear the source was. */
  certainty: z.number().min(0).max(1)
});

const ResultSchema = z.object({
  segments: z.array(SegmentSchema),
  /** Text the model could not interpret. Surfacing this is how a human knows
   *  whether the extraction missed something that mattered. */
  unreadable: z.array(z.string())
});

/**
 * The exact shape, spelled out.
 *
 * `invokeStructured` validates against Zod but never shows the model the field
 * names — it only says "return valid JSON". A model left to invent them returns
 * `hotel_name` and `check_in_date`, which fails validation for a reason the
 * error message describes badly. Naming the keys is the difference between one
 * call and three failed retries.
 */
const SHAPE = `Return exactly this shape:
{
  "segments": [{
    "kind": "flight" | "lodging" | "train" | "unknown",
    "reference": string|null,      // booking reference / PNR
    "carrier": string|null,        // airline or property NAME
    "number": string|null,         // flight or train number
    "from": string|null,           // origin (IATA code if given)
    "to": string|null,             // destination, or the property for a stay
    "departsAt": string|null,      // ISO 8601; check-in for a stay
    "arrivesAt": string|null,      // ISO 8601; check-out for a stay
    "passenger": string|null,
    "seat": string|null,
    "refundable": true|false|null,
    "amount": number|null,
    "currency": string|null,       // ISO code, e.g. "GBP"
    "hardDeadline": string|null,   // ISO 8601
    "certainty": number            // 0..1
  }],
  "unreadable": [string]
}`;

const SYSTEM = `You read travel confirmation emails and return structured data.

${SHAPE}

Rules that matter more than completeness:
- If a field is not stated, return null. Never infer a plausible value.
- Copy times EXACTLY as written, including any timezone or offset. If the email
  gives no timezone, do not add one.
- refundable: true only if the email says cancellation is free or refundable.
  false only if it says non-refundable or that cancellation is not permitted.
  null if it is silent. Silence is NOT permission.
- hardDeadline: a time after which the booking cannot be honoured at all
  (reception closing, last check-in, doors). Not the start time.
- Put anything you could not interpret into "unreadable" rather than guessing.`;

/**
 * Read an unstructured confirmation.
 *
 * Returns [] rather than throwing when the model is unreachable: an extraction
 * failure and "this email contains no booking" must stay distinguishable, and
 * the caller decides which of the two it is looking at.
 */
/**
 * A model asked to read "the 4th of August" will supply a year, and it will be
 * the year its training suggests rather than the one the email means. Observed:
 * a 2026 booking returned as 2024-08-04. Silently wrong by two years is worse
 * than absent, because every downstream prediction inherits it with confidence.
 *
 * So a date the source never stated is not trusted. Where the email carries no
 * four-digit year at all, the year is treated as unknown and the date is
 * rewritten against a reference — with the field flagged for review.
 */
function reconcileYear(
  iso: string | null,
  sourceText: string,
  reference: Date
): { value: string | null; yearWasInvented: boolean } {
  if (!iso) return { value: null, yearWasInvented: false };

  const statedYears = [...sourceText.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1]));
  const isoYear = Number(iso.slice(0, 4));
  if (!Number.isFinite(isoYear)) return { value: iso, yearWasInvented: false };

  // The email named this year explicitly — trust it.
  if (statedYears.includes(isoYear)) return { value: iso, yearWasInvented: false };

  // The email named SOME year but not this one: the model drifted. Prefer what
  // the source actually said.
  if (statedYears.length) {
    return { value: `${statedYears[0]}${iso.slice(4)}`, yearWasInvented: true };
  }

  // No year anywhere in the source. A travel booking in the past is almost
  // certainly a misread year, so roll forward to the next occurrence.
  const candidate = new Date(`${iso}${iso.length === 10 ? "T00:00:00Z" : ""}`);
  if (Number.isNaN(candidate.getTime())) return { value: iso, yearWasInvented: false };

  let year = reference.getUTCFullYear();
  const monthDay = iso.slice(4);
  if (new Date(`${year}${monthDay}${iso.length === 10 ? "T00:00:00Z" : ""}`) < reference) {
    year += 1;
  }
  return { value: `${year}${monthDay}`, yearWasInvented: true };
}

export async function extractWithModel(
  text: string,
  options: { tier?: "extract" | "flash" | "pro"; now?: Date } = {}
): Promise<{ segments: ExtractedSegment[]; unreadable: string[]; failed: string | null }> {
  const trimmed = text.trim();
  const reference = options.now ?? new Date();
  if (!trimmed) return { segments: [], unreadable: [], failed: null };

  try {
    const result = await invokeStructured(
      ResultSchema,
      `Extract every travel booking from this email.\n\n---\n${trimmed.slice(0, 12_000)}\n---`,
      { tier: options.tier ?? "extract", system: SYSTEM }
    );

    return {
      segments: result.segments.map((s) => {
        const departs = reconcileYear(s.departsAt, trimmed, reference);
        const arrives = reconcileYear(s.arrivesAt, trimmed, reference);
        const invented = departs.yearWasInvented || arrives.yearWasInvented;
        return {
        kind: s.kind,
        reference: s.reference,
        carrier: s.carrier,
        number: s.number,
        from: s.from,
        to: s.to,
        departsAt: departs.value,
        arrivesAt: arrives.value,
        // A model transcribing a local time cannot invent the zone, and the
        // whole point of carrying this flag is that nobody downstream treats
        // an ambiguous local time as an instant.
        timezoneUnknown: Boolean(s.departsAt) && !hasTimezone(s.departsAt),
        passenger: s.passenger,
        seat: s.seat,
        tier: "model" as const,
        // Capped below the deterministic tiers no matter how sure the model
        // sounds. Confident prose is not evidence — and a date whose year the
        // source never stated is capped harder still.
        confidence: invented ? Math.min(0.4, s.certainty) : Math.min(0.75, s.certainty)
        };
      }),
      unreadable: result.unreadable,
      failed: null
    };
  } catch (error) {
    return {
      segments: [],
      unreadable: [],
      failed: error instanceof Error ? error.message : "model extraction failed"
    };
  }
}

/** Everything the model found that the structured tiers cannot express. */
export type CommercialTerms = {
  refundable: boolean | null;
  amount: number | null;
  currency: string | null;
  hardDeadline: string | null;
};

export async function extractTerms(
  text: string,
  now: Date = new Date()
): Promise<CommercialTerms> {
  const result = await invokeStructured(
    ResultSchema,
    `Extract only the commercial terms from this booking email.\n\n---\n${text.slice(0, 12_000)}\n---`,
    { tier: "extract", system: SYSTEM }
  ).catch(() => null);

  const first = result?.segments?.[0];
  return {
    // `?? null` and not `?? false`: unknown refundability is not "refundable",
    // and treating silence as permission understates the loss on exactly the
    // bookings that hurt most.
    refundable: first?.refundable ?? null,
    amount: first?.amount ?? null,
    currency: first?.currency ?? null,
    // Same year trap as the segment dates: "reception closes at 11pm" carries
    // no year, and an invented one makes the deadline land in a different year
    // from the booking it guards.
    hardDeadline: reconcileYear(first?.hardDeadline ?? null, text, now).value
  };
}
