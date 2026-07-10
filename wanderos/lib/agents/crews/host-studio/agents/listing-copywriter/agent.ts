import { invokeStructured } from "@/lib/ai/structured";
import { ListingCopySchema, ListingCopy, CopywriterInput } from "./schema";
import { buildCopywriterPrompt } from "./prompt";

/**
 * listing-copywriter agent — writes the listing copy.
 *
 * Uses the "reasoning" tier (OpenAI gpt-4o-mini) — different from the Gemini agents, because
 * OpenAI tends to produce the strongest marketing copy. Grounded in the property profile +
 * the supervisor's positioning/tone, and strictly honest (no invented features).
 */
export async function listingCopywriter(input: CopywriterInput): Promise<ListingCopy> {
  return invokeStructured(ListingCopySchema, buildCopywriterPrompt(input), { tier: "reasoning" });
}
