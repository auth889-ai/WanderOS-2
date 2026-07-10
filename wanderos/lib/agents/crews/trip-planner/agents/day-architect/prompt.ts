import type { DayArchitectInput } from "./schema";

export type DaySlot = {
  dayNumber: number;
  date: string | null;
  defaultEnergy: "low" | "medium" | "high";
  minItems: number;
  maxItems: number;
};

function join(values?: string[]) {
  return values?.filter(Boolean).join(", ") || "(none)";
}

export function buildDayArchitectPrompt(input: DayArchitectInput, slots: DaySlot[]): string {
  return `You are the day-architect agent for WanderOS Trip Planner.

Create the day-level structure for a premium trip plan. You are not writing activities yet.
Do NOT invent live opening hours, exact transport times, bookings, prices, or activity rows.
Do NOT create itinerary items. Your output is only the per-day architecture.

Return JSON matching:
{
  "days": [
    {
      "dayNumber": 1,
      "date": "YYYY-MM-DD or null",
      "theme": "short theme",
      "area": "neighborhood/area anchor or null",
      "energy": "low|medium|high",
      "targetItemCount": 3
    }
  ],
  "reasoning": "short explanation"
}

Hard deterministic slots. Return exactly these dayNumbers and dates:
${JSON.stringify(slots, null, 2)}

Traveler:
- destination: ${input.brief.destination}
- date range: ${input.brief.startDate || "(unknown)"} to ${input.brief.endDate || "(unknown)"}
- party: ${input.profile.party}
- pace: ${input.profile.pace}
- budgetBand: ${input.profile.budgetBand || "(unknown)"}
- style: ${input.profile.travelStyle || input.brief.travelStyle || "(none)"}
- interests: ${join(input.profile.interests)}
- constraints: ${JSON.stringify(input.profile.constraints || {}, null, 2)}

Destination intelligence:
- neighborhoods: ${join(input.destinationIntel.neighborhoods)}
- themes: ${join(input.destinationIntel.themes)}
- anchors: ${input.destinationIntel.anchors.map((a) => `${a.name}${a.area ? ` (${a.area})` : ""}`).join(", ") || "(none)"}
- seasonality notes: ${join(input.destinationIntel.seasonalityNotes)}
- warnings: ${join(input.destinationIntel.warnings)}

Recommended real stays:
${JSON.stringify(input.stayRecommendations.map((stay) => ({
  title: stay.title,
  area: stay.area,
  pricePerNight: stay.pricePerNight,
  why: stay.why
})), null, 2)}

Rules:
- Output exactly ${slots.length} days.
- dayNumber and date must match the hard deterministic slots exactly.
- targetItemCount must stay between each slot's minItems and maxItems.
- Use area anchors to reduce travel zig-zagging.
- Use lower energy on arrival/departure days when dates exist.
- Themes should connect interests, destination context, and stay area when useful.
- Keep strings short enough for UI cards.`;
}
