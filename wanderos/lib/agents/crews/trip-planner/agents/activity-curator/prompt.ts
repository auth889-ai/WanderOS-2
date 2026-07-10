import type { DayArchitectureItem } from "../../schemas";
import type { ActivityCuratorInput, ItineraryDesignerInput } from "./schema";

export type ActivitySlot = {
  dayNumber: number;
  date: string | null;
  timeLabel: string;
  theme: string;
  area: string | null;
  energy: "low" | "medium" | "high";
};

function join(values?: string[]) {
  return values?.filter(Boolean).join(", ") || "(none)";
}

function slotLabels(count: number, energy: DayArchitectureItem["energy"]) {
  if (count <= 2) return energy === "low" ? ["Late morning", "Afternoon"] : ["Morning", "Afternoon"];
  if (count === 3) return ["Morning", "Lunch", "Evening"];
  if (count === 4) return ["Morning", "Lunch", "Afternoon", "Evening"];
  if (count === 5) return ["Early morning", "Morning", "Lunch", "Afternoon", "Evening"];
  return ["Early morning", "Morning", "Midday", "Afternoon", "Dinner", "Evening"];
}

export function buildActivitySlots(days: DayArchitectureItem[]): ActivitySlot[] {
  return days.flatMap((day) =>
    slotLabels(day.targetItemCount, day.energy).slice(0, day.targetItemCount).map((timeLabel) => ({
      dayNumber: day.dayNumber,
      date: day.date ?? null,
      timeLabel,
      theme: day.theme,
      area: day.area ?? null,
      energy: day.energy
    }))
  );
}

export function buildActivityCuratorPrompt(input: ActivityCuratorInput, slots: ActivitySlot[]): string {
  return `You are the activity-curator agent for WanderOS Trip Planner.

Create concrete itinerary item candidates for each required slot. These are editable suggestions, not bookings.
Do NOT invent listing ids, booking ids, live prices, live opening hours, exact transit durations, or guaranteed availability.
Do NOT include HTML or markdown. Keep all strings short enough for mobile UI cards.

Return JSON matching:
{
  "items": [
    {
      "dayNumber": 1,
      "timeLabel": "Morning",
      "title": "short activity title",
      "description": "one helpful sentence",
      "category": "food|culture|museum|walk|viewpoint|shopping|rest|logistics|...",
      "source": "activity-curator",
      "estCost": 25,
      "locked": false,
      "stayListingId": null
    }
  ],
  "reasoning": "short explanation"
}

Required slots. Return one item for every slot and keep dayNumber/timeLabel exactly:
${JSON.stringify(slots, null, 2)}

Traveler:
- destination: ${input.brief.destination}
- party: ${input.profile.party}
- pace: ${input.profile.pace}
- budgetBand: ${input.profile.budgetBand || "(unknown)"}
- style: ${input.profile.travelStyle || input.brief.travelStyle || "(none)"}
- interests: ${join(input.profile.interests)}
- constraints: ${JSON.stringify(input.profile.constraints || {}, null, 2)}

Destination context:
- neighborhoods: ${join(input.destinationIntel.neighborhoods)}
- themes: ${join(input.destinationIntel.themes)}
- anchors: ${input.destinationIntel.anchors.map((a) => `${a.name}${a.area ? ` (${a.area})` : ""}${a.category ? ` - ${a.category}` : ""}`).join(", ") || "(none)"}
- seasonality notes: ${join(input.destinationIntel.seasonalityNotes)}
- warnings: ${join(input.destinationIntel.warnings)}

Real stay context:
${JSON.stringify(input.stayRecommendations.map((stay) => ({
  title: stay.title,
  area: stay.area,
  why: stay.why
})), null, 2)}

Rules:
- Exactly ${slots.length} items.
- Respect dietary/accessibility/avoidance constraints.
- For low-energy days, choose lighter activities and recovery/logistics moments.
- Prefer stable place categories and neighborhoods. Avoid time-sensitive claims.
- estCost is a rough activity estimate only. Use 0 for free walks/rest/logistics.`;
}

export type ItineraryDaySlot = {
  dayNumber: number;
  date: string | null;
  defaultEnergy: "low" | "medium" | "high";
  minItems: number;
  maxItems: number;
};

export function buildItineraryDesignerPrompt(input: ItineraryDesignerInput, slots: ItineraryDaySlot[]): string {
  return `You are the itinerary-designer agent for WanderOS Trip Planner.

You combine day architecture, activity curation, and practical flow in ONE high-quality plan step.
This replaces separate slow calls. Your output must be premium, specific, and useful, but still honest.

You own:
- day theme and area anchors
- activity selection
- same-day practical ordering
- high-level warnings

You do NOT own:
- database writes
- booking status
- live transit durations
- live opening hours
- exact ticket/menu prices
- listing ids
- final budget math

Return JSON matching:
{
  "dayArchitecture": {
    "days": [
      {
        "dayNumber": 1,
        "date": "YYYY-MM-DD or null",
        "theme": "short day theme",
        "area": "neighborhood/area anchor",
        "energy": "low|medium|high",
        "targetItemCount": 3
      }
    ],
    "reasoning": "short explanation"
  },
  "items": [
    {
      "dayNumber": 1,
      "timeLabel": "Morning",
      "title": "specific place/activity title",
      "description": "specific practical sentence, not generic marketing copy",
      "category": "food|culture|museum|walk|viewpoint|shopping|rest|logistics|...",
      "source": "itinerary-designer",
      "estCost": 25,
      "locked": false,
      "stayListingId": null
    }
  ],
  "warnings": ["short practical warning"],
  "reasoning": "short explanation of route and constraint choices"
}

Hard date/pace slots. Return exactly these dayNumbers and dates. targetItemCount must be inside each min/max:
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
- anchors: ${input.destinationIntel.anchors.map((a) => `${a.name}${a.area ? ` (${a.area})` : ""}${a.category ? ` - ${a.category}` : ""}`).join(", ") || "(none)"}
- seasonality notes: ${join(input.destinationIntel.seasonalityNotes)}
- warnings: ${join(input.destinationIntel.warnings)}

Real stay context:
${JSON.stringify(input.stayRecommendations.map((stay) => ({
  title: stay.title,
  area: stay.area,
  pricePerNight: stay.pricePerNight,
  why: stay.why
})), null, 2)}

Rules:
- Output exactly ${slots.length} days.
- dayNumber and date must match hard slots exactly.
- Return item count per day equal to that day's targetItemCount.
- Order each day for a realistic traveler flow: lighter start, meals near lunch/dinner, viewpoint/night walks later.
- Respect dietary/accessibility/avoidance constraints.
- Use specific named places or specific activity concepts; avoid vague filler.
- For hot/rainy seasons, use indoor/restful anchors where appropriate.
- Do not repeat the same category all day unless requested.
- Do not invent live claims. Google/Unsplash enrichment will verify places later.
- estCost is a rough pre-enrichment estimate only. Use 0 for public walks/rest/logistics.`;
}
