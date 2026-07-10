import type { ProfilerInput } from "./schema";

function joinList(values?: string[]) {
  return values?.map((v) => v.trim()).filter(Boolean).join(", ") || "(none)";
}

/**
 * Build the profiler instruction. This agent is extraction/classification only: it prepares the
 * constraints that downstream agents must obey and the query the stay-matcher will use for pgvector.
 */
export function buildProfilerPrompt(input: ProfilerInput): string {
  return `You are the profiler agent for WanderOS Trip Planner.

Normalize the traveler brief into a strict planning profile. Do NOT plan the trip. Do NOT invent places,
listing ids, prices, bookings, or activities. Your job is to classify constraints, interests, party, pace,
budget band, and create one retrieval query for the stay-matcher.

Return JSON only matching the schema.

Traveler brief:
- destination: ${input.destination}
- dates: ${input.startDate || "(unknown)"} to ${input.endDate || "(unknown)"}
- budget: ${input.budget ?? "(unknown)"}
- travelStyle: ${input.travelStyle || "(none)"}
- party: ${input.party || "(not specified)"}
- pace: ${input.pace || "balanced"}
- interests: ${joinList(input.interests)}
- constraints: ${JSON.stringify(input.constraints || {}, null, 2)}

Rules:
- party must be concise and useful for matching stays, e.g. "solo", "couple", "family", "friends".
- travelerCount should be included when clearly inferable from party; otherwise omit it.
- budgetBand must be one of budget, midrange, premium, luxury when budget/style imply it.
- pace must be relaxed, balanced, or packed.
- interests must be canonical short phrases, de-duplicated, max 8.
- constraints must preserve safety, accessibility, dietary, mobility, child, work, and avoidance requirements.
- query must include destination, party, style, interests, budgetBand if known, and constraints relevant to stays.
- reasoning should explain only how you normalized the brief.`;
}
