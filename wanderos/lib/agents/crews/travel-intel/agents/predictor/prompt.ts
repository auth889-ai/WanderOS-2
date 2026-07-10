type Ctx = { destination: string; weather?: string; holidayOverlap: boolean; soonestHoliday?: string; avgRating?: number; interests?: string[] };
export function buildPredictorPrompt(c: Ctx) {
  return `You are the Trip Experience Predictor. Estimate the REAL experience for ${c.destination} using ONLY these signals:
- Weather (Open-Meteo): ${c.weather || "unknown"}
- Travel overlaps a holiday/long-weekend: ${c.holidayOverlap ? `YES (${c.soonestHoliday || "holiday"}) → expect more crowds` : "no major holiday → lighter crowds"}
- Avg attraction rating (Places): ${c.avgRating ?? "n/a"}
- Traveler interests: ${(c.interests || []).join(", ") || "general"}
Reason honestly (a holiday overlap raises crowd + regret-for-peace-seekers; heavy rain lowers weather comfort).
Return JSON: { vibe (short phrase), crowdLevel, weatherComfort, regretRisk (low|medium|high each), bestFor (who), avoidIf (who should skip) }.`;
}
