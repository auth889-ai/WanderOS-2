type Ctx = {
  destination: string; country: string; budget?: string; interests?: string[];
  holidays: { name: string; date: string; daysLeft: number; longWeekend: boolean }[];
  events: { name: string; date?: string; venue?: string }[];
  festivalPlaces: { name: string }[];
  attractions: { name: string; rating?: number }[];
  stays: { title: string; city: string; price: string }[];
};
export function buildCardComposerPrompt(c: Ctx) {
  return `You are WanderOS Travel Intelligence — turn ONLY the REAL data below into source-grounded insight for ${c.destination} (${c.country}).
NEVER invent holidays, events, places, or stays not in the data. If a section is empty, don't fabricate it.
USER: budget=${c.budget || "unspecified"} · interests=${(c.interests || []).join(", ") || "general"}
REAL holidays (Calendarific): ${c.holidays.map((h) => `${h.name} (${h.date}, in ${h.daysLeft}d${h.longWeekend ? ", long weekend" : ""})`).join(" | ") || "none"}
REAL events (Ticketmaster): ${c.events.map((e) => `${e.name}${e.date ? ` (${e.date})` : ""}`).join(" | ") || "none"}
REAL festival/cultural places (Places): ${c.festivalPlaces.map((p) => p.name).join(" | ") || "none"}
REAL attractions (Places): ${c.attractions.map((a) => `${a.name}${a.rating ? ` ★${a.rating}` : ""}`).join(" | ") || "none"}
REAL WanderOS stays: ${c.stays.map((s) => `${s.title} (${s.city}, ${s.price})`).join(" | ") || "none"}
Return JSON:
- summary: 2–3 sentences, grounded in the data.
- triggers: 1–4 PREDICTIVE cards. Strongest = a holiday-aware trip trigger using the SOONEST holiday + budget + (if available) a real stay. Each {title, body}. Real data only.
- festivals: rank REAL cultural holidays + events + festival places that matter to a visitor; each {name, when?, why}. Empty if no real festival data.`;
}
