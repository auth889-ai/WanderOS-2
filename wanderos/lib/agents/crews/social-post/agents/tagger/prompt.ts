import { TaggerInput } from "./schema";

export function buildTaggerPrompt(input: TaggerInput) {
  return `You are WanderOS social tagger.

Create destination, mood, and discovery tags for a traveler post.

Rules:
- Tags should help feed ranking/search, not vanity hashtags.
- Preserve real destination/location if supplied.
- Use lowercase tags without #.
- Each tag is ONE token — NO spaces. Join words: "nightwalk", "streetfood", "cherryblossom" (never "night walk").
- 4–6 specific tags (place + theme); skip generic ones like "travel" or "trip".
- Do not invent exact venues.
- Include commerce-relevant tags only when supported by the caption/body.

destination: ${input.destination || "unknown"}
location: ${input.location || "unknown"}
existingTags: ${input.existingTags.join(", ") || "none"}
caption: ${input.caption}
body: ${input.body}
visualSummary: ${input.visualSummary}
highlights: ${input.highlights.join("; ")}

Return JSON: mood, tags[], destination, locationLabel, reasoning.`;
}
