import { z } from "zod";
import { flexStringArray, confidence01 } from "@/lib/ai/zod-helpers";

/**
 * listing-copywriter — input + output contracts.
 * Writes the listing copy, grounded in the property profile. The copywriter SELF-DERIVES its own
 * positioning + tone from the property's aesthetic and highlights (no separate planner agent).
 * Honest: only claims what the profile/notes + confirmed facts support — never over-claims.
 */
export type CopywriterInput = {
  category: string;
  city: string;
  country: string;
  topHighlights: string[]; // from aggregator
  allAmenities: string[]; // from aggregator
  aestheticStyle: string; // from aggregator
  notes: string;
  // authoritative extracted facts: the copy MUST stay consistent with these (no over-claiming)
  facts?: { bedrooms: number; bathrooms: number; maxGuests: number; amenities: string[] };
};

export const ListingCopySchema = z.object({
  title: z.string().describe("catchy listing title, ~5-9 words, specific not clickbait"),
  tagline: z.string().describe("a one-line hook under the title"),
  shortDescription: z.string().describe("1-2 sentence summary for listing cards"),
  longDescription: z.string().describe("2-3 short paragraphs — warm, specific, honest"),
  highlights: flexStringArray.describe("4-6 punchy bullet selling points"),
  guestPromise: z.string().describe("what the guest will feel/experience staying here"),
  callToAction: z.string().describe("a short closing line inviting a booking"),
  seoKeywords: flexStringArray.describe("4-8 search keywords for discovery"),
  confidence: confidence01.describe("confidence the copy is accurate + compelling, 0-1"),
  reasoning: z.string().describe("how the copy was shaped from the profile + tone")
});

export type ListingCopy = z.infer<typeof ListingCopySchema>;
