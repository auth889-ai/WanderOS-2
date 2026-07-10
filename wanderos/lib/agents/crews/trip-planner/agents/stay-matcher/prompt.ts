import type { StayCandidate, StayMatcherInput } from "./schema";

function join(values?: string[]) {
  return values?.filter(Boolean).join(", ") || "(none)";
}

export function buildStayMatcherPrompt(input: StayMatcherInput, candidates: StayCandidate[]): string {
  return `You are the stay-matcher agent for WanderOS Trip Planner.

Your job is to rank real, approved WanderOS stay candidates for this traveler. You may only choose from
the candidate listingIds provided below. Do NOT invent hotels, listing ids, prices, availability, booking
status, or live claims. The deterministic service has already applied approval, destination, party, and
budget filters. You are only judging fit and writing concise reasons.

Traveler:
- destination: ${input.brief.destination}
- dates: ${input.brief.startDate || "(unknown)"} to ${input.brief.endDate || "(unknown)"}
- budget: ${input.profile.budget ?? input.brief.budget ?? "(unknown)"}
- budgetBand: ${input.profile.budgetBand || "(unknown)"}
- party: ${input.profile.party}
- travelerCount: ${input.profile.travelerCount ?? "(unknown)"}
- pace: ${input.profile.pace}
- style: ${input.profile.travelStyle || input.brief.travelStyle || "(none)"}
- interests: ${join(input.profile.interests)}
- constraints: ${JSON.stringify(input.profile.constraints || {}, null, 2)}

Destination context:
- neighborhoods: ${join(input.destinationIntel?.neighborhoods)}
- themes: ${join(input.destinationIntel?.themes)}
- warnings: ${join(input.destinationIntel?.warnings)}

Candidates, all from Aurora:
${JSON.stringify(candidates, null, 2)}

Rules:
- Return at most 3 picks.
- Every listingId must exactly match one candidate listingId.
- Prefer strong semantic fit, destination fit, capacity fit, and budget fit.
- Explain why the stay fits the traveler's actual trip, not generic marketing.
- If no candidate is a good fit, return fewer than 3 picks.
- matchScore is your confidence from 0 to 1 after considering the deterministicScore.`;
}
