import { z } from "zod";

/**
 * quality-gate — the canonical contract a listing draft MUST satisfy before it can be composed
 * and published. Deterministic (Zod, no LLM): this is the structural safety net after all the
 * generative agents — it cannot be talked out of the rules.
 */
export const ListingDraftSchema = z.object({
  title: z.string().trim().min(3, "title too short"),
  shortDescription: z.string().trim().min(10, "shortDescription too short"),
  longDescription: z.string().trim().min(30, "longDescription too short"),
  highlights: z.array(z.string()).min(1, "need at least one highlight"),
  price: z.number().positive("price must be > 0"),
  currency: z.string().trim().min(1, "currency required"),
  bedrooms: z.number().int().min(0),
  bathrooms: z.number().min(0),
  maxGuests: z.number().int().min(1, "maxGuests must be >= 1"),
  amenities: z.array(z.string()),
  tags: z.array(z.string()),
  safetyVerdict: z.enum(["approve", "flag", "reject"])
});

export type ListingDraft = z.infer<typeof ListingDraftSchema>;

/** The gate's verdict: structurally valid? safe to publish? what failed, what was repaired? */
export type QualityGateResult = {
  valid: boolean; // passes the structural schema
  publishable: boolean; // valid AND safety verdict is not 'reject'
  errors: string[]; // hard problems blocking publish
  repairs: string[]; // safe normalizations applied
  draft: ListingDraft | null; // the cleaned draft (null if invalid)
};
