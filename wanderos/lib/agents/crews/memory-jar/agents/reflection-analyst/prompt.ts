type Mem = { caption?: string; place?: string; year?: number };
export function buildReflectionPrompt(c: { name: string; memories: Mem[] }) {
  const lines = c.memories.slice(0, 40).map((m) => `${m.year ?? ""} ${[m.place, m.caption].filter(Boolean).join(" — ")}`).join("\n");
  return `You are a thoughtful AI reflecting on ${c.name}'s travel memories across time, to mirror their growth and gently predict their path.
Memories (newest first):
${lines || "(few memories yet — be hopeful)"}

Return JSON:
- growthLine: 1 warm sentence on how they have CHANGED through these journeys.
- prediction: 1–2 sentences — an AI PREDICTIVE reflection: where they seem to be heading and how they'll keep growing (hopeful, specific to their themes).
- futureSelfMessage: a short, heartfelt message (2–3 sentences) to deliver to their FUTURE self, in second person ("you").
- themes: 2–5 recurring themes in their travels (e.g. "food", "solitude", "cities at night").`;
}
