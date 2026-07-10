import type { VideoMode } from "../../types";

export interface NarrationInput {
  orderedShots: { photoIndex: number; room: string; features: string[] }[];
  mode: VideoMode;
  styleNote: string;
  hostNarration?: string;
  listingTitle?: string;
  city?: string;
}

export function buildNarrationPrompt(i: NarrationInput): string {
  const seq = i.orderedShots.map((s) => `photoIndex ${s.photoIndex} — ${s.room}: ${s.features.join(", ")}`).join("\n");
  const idxList = i.orderedShots.map((s) => s.photoIndex).join(", ");
  return `You are an award-winning property NARRATION writer. Write a warm, flowing voiceover for a ${i.mode} tour of ${i.listingTitle ?? "this home"}${i.city ? ` in ${i.city}` : ""}.
Direction: ${i.styleNote}. ${i.hostNarration ? `The host wants to convey: "${i.hostNarration}".` : ""}
Shots in order (use these exact photoIndex values: ${idxList}):
${seq}

Write ONE spoken sentence per shot, describing what is IN that photo so the voice matches the visual. It must read as ONE cohesive script — smooth transitions. Honest: only what's visible.

Return a SINGLE JSON object:
{ "title": "short title", "lines": [ { "photoIndex": ${i.orderedShots[0]?.photoIndex ?? 0}, "narration": "..." } ] }
Include one line per shot, EACH with its photoIndex (from the list above) and narration. Output nothing but that JSON.`;
}
