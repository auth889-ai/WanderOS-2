import { PhotoCuratorInput } from "./schema";
export function buildPhotoCuratorPrompt(input: PhotoCuratorInput) {
  const list = input.photos.map((p) => `#${p.index} ${p.location ? `[${p.location}] ` : ""}${p.date ? `(${p.date}) ` : ""}${p.description}`).join("\n");
  return `You are the photo-curator for a premium travel Memory Book.
Group these photos into chapters that tell a story (by place, day, or theme).
Rules:
- Use AS MANY chapters as the trip needs — a long trip = many chapters. Do NOT force everything into a few.
- **Group 3–5 photos per chapter** — photos from the SAME place or SAME day belong together.
- **Place EVERY photo** — each photo index appears in exactly one chapter. Do not drop photos (you may, at most, drop an exact duplicate).
- Each chapter: a short evocative title, the place (if clear), a one-word vibe (joyful/serene/adventurous/nostalgic/foodie/luxe), and the photoIndexes IN A GOOD VIEWING ORDER.
- Use ONLY the indexes listed below.

Photos:
${list}

Return JSON: { chapters: [{ title, place?, vibe, photoIndexes:[...] }] }`;
}
