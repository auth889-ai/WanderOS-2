type Ctx = { destination: string; country: string; dateFrom: string; dateTo: string; weather?: string; attractions: string[]; festivalsInRange: string[]; interests?: string[] };
export function buildDateWindowPrompt(c: Ctx) {
  return `A traveler will be in ${c.destination}, ${c.country} from ${c.dateFrom} to ${c.dateTo}. Weather outlook: ${c.weather || "unknown"}.
Interests: ${(c.interests || []).join(", ") || "general"}.

Recommend the 5–8 BEST, MOST ICONIC, SPECIFIC places to visit in/near ${c.destination} for THESE EXACT dates — chosen for the SEASON.
- Use FAMOUS, real, named spots (the ones a knowledgeable local or a top travel guide would name), not generic "a tea garden".
  e.g. monsoon ${c.destination}: prioritise the signature water/nature spots that SHINE in the rain (swamp forests, waterfalls, blue rivers, stone-collection points), plus a couple of all-weather cultural/indoor picks for heavy-rain days.
- Be honest about SEASON access: monsoon → many water spots are most beautiful but warn about boat/road/water-level/slippery access; dry → different picks.
${c.festivalsInRange.length ? `- Festivals during these dates: ${c.festivalsInRange.join(", ")} — tie at least one place/plan to one of them.` : ""}
- Variety matters: do NOT list 4 tea gardens. Mix nature, water, culture, and a rainy-day indoor option.
${c.attractions.length ? `(Verified nearby attractions you MAY also use: ${c.attractions.slice(0, 8).join(", ")}.)` : ""}

For each place: "name" = the REAL specific place name (geocodable), "why" = 1 vivid line tying it to the dates/season + any access caveat.
Return JSON: { seasonNote (1–2 honest sentences on the season), bestPlaces:[{name, why}], tips (1 practical thing to check/pack/book) }.`;
}
