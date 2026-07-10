import { z } from "zod";
import { flexStringArray, confidence01 } from "@/lib/ai/zod-helpers";

/**
 * final-composer — input + output contracts.
 * Assembles every agent's validated output into ONE canonical ListingDraft the host reviews.
 * The structured fields are assembled DETERMINISTICALLY (the LLM must NOT rewrite already-validated
 * copy/price/facts). The LLM adds only the host handoff layer (a summary + what to confirm).
 */
export type ComposerInput = {
  category: string;
  city: string;
  country: string;
  copy: { title: string; shortDescription: string; longDescription: string; highlights: string[] };
  pricing: { suggested: number; min: number; max: number; currency: string; confidence: number };
  amenities: { amenities: string[]; bedrooms: number; bathrooms: number; maxGuests: number; missingInfo: string[] };
  safety: { verdict: string; riskLevel: string; flags: string[] };
  tags: string[];
  vibes: string[];
};

/** The LLM produces ONLY this host-facing handoff (it never touches the validated content). */
export const ComposerHandoffSchema = z.object({
  hostSummary: z.string().describe("one warm paragraph for the host: what the AI built for their listing"),
  thingsToConfirm: flexStringArray.describe("specific items the host should verify before publishing (from missingInfo + safety flags + low pricing confidence)"),
  readyToPublish: z.boolean().describe("true if nothing blocks publishing (safety not reject, no critical gaps)"),
  confidence: confidence01.describe("confidence the listing is complete and ready, 0-1"),
  reasoning: z.string().describe("how readiness was judged")
});
export type ComposerHandoff = z.infer<typeof ComposerHandoffSchema>;

/** The full composed listing: deterministically assembled fields + the LLM handoff. */
export type ComposedListing = {
  title: string;
  shortDescription: string;
  longDescription: string;
  highlights: string[];
  price: number;
  priceMin: number;
  priceMax: number;
  currency: string;
  bedrooms: number;
  bathrooms: number;
  maxGuests: number;
  amenities: string[];
  tags: string[];
  vibes: string[];
  category: string;
  city: string;
  country: string;
  safetyVerdict: string;
  riskLevel: string;
} & ComposerHandoff;
