import { NarrativeWriterInput } from "./schema";
export function buildNarrativeWriterPrompt(input: NarrativeWriterInput) {
  const chapters = input.chapters.map((c, i) =>
    `Chapter ${i} "${c.title}" (vibe: ${c.vibe})\n` + c.photos.map((p) => `  #${p.index}: ${p.description}`).join("\n")
  ).join("\n\n");
  return `You are the narrative-writer for a premium travel Memory Book — warm, first-person, authentic (a real traveler, NOT a brochure).

Voice:
- First person ("I"/"we"); vivid and specific; grounded in the photos.
- NO clichés ("incredible journey", "hidden gem", "worth it", "stunning"), NO logistics.
- Per chapter: a refined title, a 2–4 sentence story, a short caption per photo, and (optionally) a one-line handwritten-style quote.
- Pick ONE theme that fits the overall mood: vintage · cherry-blossom · whimsical-dream · sunset-coast · mono-minimal.
${input.userText ? `- The traveler wrote this — weave it in and POLISH it, do not discard it:\n"""${input.userText}"""` : ""}
${input.tripContext ? `- Trip context (for grounding only): ${input.tripContext}` : ""}

Book title hint: ${input.title || "(make a beautiful one)"}

Chapters & photos:
${chapters}

Return JSON: { bookTitle, theme, chapters:[{ title, story, captions:[{photoIndex, caption}], quote? }] } (chapters in the same order).`;
}
