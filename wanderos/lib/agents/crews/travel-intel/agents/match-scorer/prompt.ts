type In = { profile: { budget?: string; interests: string[]; travelStyle?: string }; candidates: { name: string; kind: string; hint?: string }[] };
export function buildMatchScorerPrompt(input: In) {
  const p = input.profile;
  return `You are the personalization scorer for a travel-intelligence engine (like a job fit-scorer, but for places).
Score EACH candidate 0–100 for how well it fits THIS specific traveler, and give a one-line reason that references their profile.

TRAVELER: budget=${p.budget || "unspecified"} · interests=${p.interests.join(", ") || "general"} · style=${p.travelStyle || "any"}

CANDIDATES:
${input.candidates.map((c, i) => `${i}. [${c.kind}] ${c.name}${c.hint ? ` — ${c.hint}` : ""}`).join("\n")}

Scoring: reward strong interest/budget/style fit; penalize mismatches (e.g. luxury place on a tight budget, city for a nature-lover).
Return JSON: { scored: [{ name (exactly as given), score, reason }] } — one per candidate.`;
}
