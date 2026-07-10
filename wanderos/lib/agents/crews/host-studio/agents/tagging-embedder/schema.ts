import { z } from "zod";
import { flexStringArray, confidence01 } from "@/lib/ai/zod-helpers";

/**
 * tagging-embedder — input + output contracts.
 * Produces discovery metadata (tags/vibes/keywords) AND writes the listing's embedding into
 * pgvector — so the listing becomes part of WanderOS's RAG memory (future supervisor/pricing
 * agents will retrieve THIS listing as a comparable). It's an action-taking agent: it writes.
 */
export type TaggingInput = {
  listingId: string;
  category: string;
  city: string;
  country: string;
  title: string;
  description: string;
  amenities: string[];
};

export const TagsSchema = z.object({
  tags: flexStringArray.describe("8-15 concise lowercase discovery tags grounded in the listing"),
  vibes: flexStringArray.describe("2-5 experiential vibe tags (e.g. 'romantic', 'work-friendly', 'budget')"),
  searchKeywords: flexStringArray.describe("phrases a traveler might search to find this listing"),
  confidence: confidence01.describe("confidence in these tags, 0-1"),
  reasoning: z.string().describe("how the tags were derived from the listing")
});

export type ListingTags = z.infer<typeof TagsSchema>;

/** The agent's full result: the tags + whether the embedding was written, and its id. */
export type TagAndEmbedResult = ListingTags & { embedded: boolean; embeddingId?: string };
