import { invokeStructured } from "@/lib/ai/structured";
import { remember } from "@/lib/agents/tools/pgvector-retriever.tool";
import { TagsSchema, TaggingInput, TagAndEmbedResult } from "./schema";
import { buildTaggingPrompt } from "./prompt";

/**
 * tagging-embedder agent — generates discovery tags AND embeds the listing into pgvector.
 *
 * Two responsibilities, one job: make the listing discoverable (tags) and make it part of
 * WanderOS's RAG memory (the embedding). Uses "flash" (Gemini) for the tags, then takes the
 * ACTION of writing the embedding via remember() — so future agents retrieve THIS listing as
 * real market context. This closes the RAG loop.
 */
export async function taggingEmbedder(input: TaggingInput): Promise<TagAndEmbedResult> {
  // 1. generate discovery tags
  const tags = await invokeStructured(TagsSchema, buildTaggingPrompt(input), { tier: "flash" });

  // 2. ACTION: write the listing's embedding into pgvector (it joins WanderOS's memory)
  const content = `${input.title}. ${input.description}. Amenities: ${input.amenities.join(", ")}. Tags: ${tags.tags.join(", ")}.`;
  const rec = await remember({
    ownerType: "listing",
    ownerId: input.listingId,
    content,
    metadata: { category: input.category, city: input.city, country: input.country }
  });

  return { ...tags, embedded: Boolean(rec?.id), embeddingId: rec?.id };
}
