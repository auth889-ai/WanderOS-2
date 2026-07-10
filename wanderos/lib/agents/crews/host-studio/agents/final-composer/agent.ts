import { ComposedListing, ComposerInput } from "./schema";

/**
 * final-composer — the crew's final handoff. FULLY DETERMINISTIC (no LLM).
 *
 * Assembles every validated part into ONE canonical ListingDraft. The structured content is copied
 * verbatim (so nothing can silently rewrite the validated copy, the grounded price, or the facts),
 * and the host-facing handoff (summary + "things to confirm" + readiness) is derived directly from
 * the upstream signals — no model call, so it's instant, free, and 100% consistent with the draft.
 */
export async function finalComposer(input: ComposerInput): Promise<ComposedListing> {
  // 1. deterministic assembly — verbatim validated content
  const assembled = {
    title: input.copy.title,
    shortDescription: input.copy.shortDescription,
    longDescription: input.copy.longDescription,
    highlights: input.copy.highlights,
    price: input.pricing.suggested,
    priceMin: input.pricing.min,
    priceMax: input.pricing.max,
    currency: input.pricing.currency,
    bedrooms: input.amenities.bedrooms,
    bathrooms: input.amenities.bathrooms,
    maxGuests: input.amenities.maxGuests,
    amenities: input.amenities.amenities,
    tags: input.tags,
    vibes: input.vibes,
    category: input.category,
    city: input.city,
    country: input.country,
    safetyVerdict: input.safety.verdict,
    riskLevel: input.safety.riskLevel
  };

  // 2. host handoff, derived from the signals (no LLM):
  //    things to confirm = the facts the host should verify (missing info + safety flags + a thin price)
  const lowPriceConfidence = input.pricing.confidence < 0.5;
  const thingsToConfirm = [
    ...input.amenities.missingInfo,
    ...input.safety.flags,
    ...(lowPriceConfidence
      ? [`Confirm the suggested price (${assembled.price} ${assembled.currency}) — pricing confidence is low`]
      : [])
  ];

  // ready only when nothing blocks it: safety not 'reject' (and not an unresolved 'flag')
  const readyToPublish = input.safety.verdict === "approve";

  // overall readiness confidence: anchored on the weakest signals (price + safety)
  const safetyConfidence = input.safety.verdict === "approve" ? 1 : input.safety.verdict === "flag" ? 0.6 : 0.2;
  const confidence = Math.round(Math.min(input.pricing.confidence, safetyConfidence) * 100) / 100;

  const hostSummary =
    `We've drafted "${assembled.title}" — a ${assembled.bedrooms}-bed, ${assembled.bathrooms}-bath ` +
    `${input.category} in ${input.city} that sleeps ${assembled.maxGuests}, priced at ` +
    `${assembled.price} ${assembled.currency}. Review the details below` +
    (thingsToConfirm.length ? ` and confirm the ${thingsToConfirm.length} flagged item(s)` : "") +
    ` before publishing.`;

  const reasoning = readyToPublish
    ? `Safety verdict is 'approve'; ${thingsToConfirm.length} item(s) to confirm but none block publishing.`
    : `Not auto-ready: safety verdict is '${input.safety.verdict}'. Host should resolve flagged items before publishing.`;

  return { ...assembled, hostSummary, thingsToConfirm, readyToPublish, confidence, reasoning };
}
