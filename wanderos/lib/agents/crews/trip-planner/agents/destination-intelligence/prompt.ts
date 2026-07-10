import type { DestinationIntelligenceInput } from "./schema";

function monthName(value?: string) {
  if (!value) return "(unknown)";
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "(unknown)";
  return date.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
}

function list(values?: string[]) {
  return values?.filter(Boolean).join(", ") || "(none)";
}

/**
 * Build the destination-intelligence instruction.
 * This agent adds planning context only: themes, areas, seasonality notes, anchors, and warnings.
 */
export function buildDestinationIntelligencePrompt(input: DestinationIntelligenceInput): string {
  const { brief, profile } = input;
  return `You are the destination-intelligence agent for WanderOS Trip Planner.

Produce compact destination context for a premium travel planning crew. Do NOT create an itinerary schedule.
Do NOT invent live prices, live opening hours, listing ids, booking availability, or exact transport times.
Use broad travel knowledge and the traveler profile to choose useful areas, trip themes, anchors, and reality warnings.

Return JSON only matching the schema:
{
  "destination": "string",
  "seasonalityNotes": ["string"],
  "neighborhoods": ["string"],
  "themes": ["string"],
  "anchors": [{"name":"string","area":"string","category":"string","why":"string"}],
  "warnings": ["string"]
}

Traveler context:
- destination: ${brief.destination}
- date month: ${monthName(brief.startDate)}
- date range: ${brief.startDate || "(unknown)"} to ${brief.endDate || "(unknown)"}
- party: ${profile.party}
- pace: ${profile.pace}
- budgetBand: ${profile.budgetBand || "(unknown)"}
- travelStyle: ${profile.travelStyle || brief.travelStyle || "(none)"}
- interests: ${list(profile.interests)}
- constraints: ${JSON.stringify(profile.constraints || {}, null, 2)}

Rules:
- destination should preserve the requested destination name.
- neighborhoods should be practical area anchors for planning days/stays.
- themes should connect interests + travel style + pace.
- anchors should be stable categories or well-known destination anchors, not live events.
- warnings should include only useful planning risks: weather/seasonality, crowding, mobility, dietary, safety, budget, or pacing.
- If a fact could be time-sensitive, phrase it as a planning note, not a live guarantee.
- Keep every string short enough for UI panels.`;
}
