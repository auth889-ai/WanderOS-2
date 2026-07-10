/** shot-vision prompt — perceive each photo honestly. Demands ONE wrapped JSON object. */
export function buildShotVisionPrompt(photoCount: number): string {
  return `You are a real-estate cinematographer's EYE. You see ${photoCount} photos, indexed 0..${photoCount - 1}.
For each photo identify: room (what is ACTUALLY shown), features (2-4 visible highlights), motionHint (a fitting camera move).
Describe ONLY what is visibly present — never invent.

Return a SINGLE JSON object with ALL photos inside one "shots" array (NOT one object per photo):
{ "shots": [ { "photoIndex": 0, "room": "...", "features": ["...","..."], "motionHint": "..." } ] }
Include every photo (photoIndex 0..${photoCount - 1}). Output nothing but that one JSON object.`;
}
