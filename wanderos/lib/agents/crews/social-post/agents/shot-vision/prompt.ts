import { ShotVisionInput } from "./schema";

export function buildShotVisionPrompt(input: ShotVisionInput) {
  const photos = input.media.filter((m) => m.mediaKind === "photo");
  return `You are WanderOS shot-vision for a traveler social-commerce feed.

Task:
- Inspect the uploaded trip photos.
- Select strongest shots for a premium travel post.
- Describe only visible evidence. Do not invent a stay, booking, rating, place, or exact location.
- If location is uncertain, say it is a clue, not a fact.
- Write useful alt text for accessibility.

Post title: ${input.title}
Destination: ${input.destination || "unknown"}
Location: ${input.location || "unknown"}
Photo count: ${photos.length}

Return JSON with:
visualSummary, vibe, bestShots[], placeClues[], honestyNotes[].`;
}
