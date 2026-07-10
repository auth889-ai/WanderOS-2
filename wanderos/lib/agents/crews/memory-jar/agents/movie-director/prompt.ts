type Mem = { caption?: string; place?: string };
export function buildMovieDirectorPrompt(c: { name: string; year: number | string; memories: Mem[] }) {
  const lines = c.memories.slice(0, 20).map((m, i) => `${i + 1}. ${[m.place, m.caption].filter(Boolean).join(" — ")}`).join("\n");
  return `You are a film director making a short cinematic movie that makes the traveler feel like the STAR of their own travel film — like a Netflix trailer of their year.
Traveler: ${c.name}. Year: ${c.year}.
Their memories:
${lines || "(a quiet year — be hopeful and cinematic)"}

Return JSON for the title sequence + tone:
- title: a short, evocative FILM title (2–4 words) drawn from their journey (not a place list).
- logline: one cinematic line under the title.
- starringLine: exactly "Starring ${c.name}".
- emotion: the film's dominant feeling.
- narrationHint: 1–2 sentences guiding the voiceover — warm, second-person ("you"), about THEIR journey and growth (not a place description).
- creditLine: exactly "Directed by ${c.name}".`;
}
