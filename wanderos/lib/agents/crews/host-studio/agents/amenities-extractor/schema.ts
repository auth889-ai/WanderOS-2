import { z } from "zod";
import { flexStringArray, confidence01 } from "@/lib/ai/zod-helpers";

/**
 * amenities-extractor — input + output contracts.
 * Turns the property profile + host notes into the DEFINITIVE structured facts that populate the
 * listing (amenities, counts, bed config, house rules). Honest: only what's supported; flags gaps.
 */
export type AmenitiesInput = {
  category: string;
  notes: string;
  detectedAmenities: string[]; // from aggregator (allAmenities)
  roomsCovered: string[]; // from aggregator
};

export const AmenitiesSchema = z.object({
  amenities: flexStringArray.describe("canonical, de-duplicated amenities supported by the evidence"),
  standoutAmenities: flexStringArray.describe("the 2-5 most booking-influencing amenities"),
  bedrooms: z.number().int().describe("number of bedrooms (infer from rooms/notes; 0 for studio)"),
  bathrooms: z.number().describe("number of bathrooms (0.5 increments allowed)"),
  maxGuests: z.number().int().describe("sensible max guests for this property"),
  bedConfiguration: flexStringArray.describe("bed setup, e.g. '1 king', '2 singles' — empty if unknown"),
  houseRules: flexStringArray.describe("house rules ONLY if supported by the notes (no smoking, no pets, etc.)"),
  missingInfo: flexStringArray.describe("facts the host should confirm (e.g. 'bathroom count not stated')"),
  confidence: confidence01.describe("confidence in these extracted facts, 0-1"),
  reasoning: z.string().describe("how counts/amenities were inferred and what was assumed")
});

export type AmenitiesFacts = z.infer<typeof AmenitiesSchema>;
