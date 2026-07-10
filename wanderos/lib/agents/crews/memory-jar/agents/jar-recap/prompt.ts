type Mem = { title?: string; caption?: string; place?: string; mood?: string };
export function buildJarRecapPrompt(c: { year: number | string; memories: Mem[] }) {
  const lines = c.memories.slice(0, 30).map((m, i) => `${i + 1}. ${[m.title, m.place, m.caption, m.mood].filter(Boolean).join(" — ")}`).join("\n");
  return `You are the AI Memory Narrator for a cinematic "Living Memory Jar". Reflect on this traveler's ${c.year} memories and produce an emotional yearly recap.
Memories:
${lines || "(a quiet year — be gentle and hopeful)"}

Return JSON:
- topMoment: the single most meaningful moment (short, evocative).
- mood: the year's overall emotional tone (e.g. "Peaceful & Inspired").
- favoriteFeeling: one word/short phrase (e.g. "Grateful").
- growthLine: one warm sentence about how they grew ("You explored more, felt deeper, and became stronger.").
- narration: 2–3 sentences in a soft, cinematic narrator voice (first/second person), as if opening their memory jar.
- emotionalWeather: the atmosphere that best fits the year.
- particleType: matching floating particles.
- glow: a hex color for the jar's glow that matches the mood.`;
}
