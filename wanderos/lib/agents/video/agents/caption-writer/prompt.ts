export function buildCaptionPrompt(orderedShots: { photoIndex: number; room: string }[]): string {
  const seq = orderedShots.map((s) => `photoIndex ${s.photoIndex}: ${s.room}`).join("\n");
  return `Write punchy, scroll-stopping on-screen CAPTIONS (max ~5 words each, no quotes) for these property tour shots:
${seq}

Return a SINGLE JSON object:
{ "captions": [ { "photoIndex": ${orderedShots[0]?.photoIndex ?? 0}, "caption": "..." } ] }
One caption per shot, EACH with its photoIndex from the list above. Output nothing but that JSON.`;
}
