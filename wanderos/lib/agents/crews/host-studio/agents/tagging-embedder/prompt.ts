import { TaggingInput } from "./schema";

/** Builds the tagging instruction — discovery metadata grounded in the listing. */
export function buildTaggingPrompt(input: TaggingInput): string {
  return `You are a listing tagger for a travel marketplace. Produce discovery metadata for this
${input.category} in ${input.city}, ${input.country} so the right travelers can find it. Ground every
tag in the listing — do NOT invent features.

LISTING
- Title: ${input.title}
- Description: ${input.description}
- Amenities: ${input.amenities.join(", ") || "(none)"}

PRODUCE
- tags: 8-15 concise, lowercase discovery tags (e.g. "city-center", "pet-friendly", "balcony")
- vibes: 2-5 experiential vibes this place genuinely suits (e.g. "romantic", "work-friendly")
- searchKeywords: natural phrases a traveler might type to find this listing
- confidence (0-1) and reasoning`;
}
