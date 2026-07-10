import { PricingInput } from "./schema";

/** System prompt — instructs the agent to ACT (use its tools) before pricing. */
export const PRICING_SYSTEM_PROMPT = `You are a property Pricing Analyst. You MUST price using real evidence, never a guess.
You have INTERNAL tools (our marketplace) and EXTERNAL tools (real-world market intelligence). Your process:
1. Call searchComparables(city, category) for same-category comps.
2. If it returns fewer than 3 comps, call broadenSearch(city) to widen to all categories.
3. Call locationIntel(city) to gauge location desirability (nearby attractions raise demand).
4. Call seasonalDemand(city, country) to check upcoming events/holidays (near-term demand spikes).
5. Then STOP calling tools and give your final pricing: anchor on the comps, then ADJUST up/down for
   the location signal and the seasonal/event signal.
DECIDE YOUR OWN PRICING POSTURE from the evidence: a high quality score + strong amenities + a desirable
location justify a PREMIUM posture; an average property vs the comps is COMPETITIVE; a weak/sparse one is VALUE.
Reason from the actual comp prices/quality scores AND the external signals. If a tool says unavailable,
note it and proceed. If comp data is thin, lower your confidence.`;

/** The task message describing the property to price. */
export function buildPricingTask(input: PricingInput): string {
  return `Price this property:
- Category: ${input.category}
- Location: ${input.city}, ${input.country}
- Quality score: ${input.qualityScore}/100
- Amenities: ${input.amenities.join(", ") || "(none listed)"}

Use your INTERNAL comps tools AND your EXTERNAL tools (locationIntel, seasonalDemand), decide your own
pricing posture (value / competitive / premium) from the evidence, then recommend a nightly price.`;
}

/** Final prompt: turn the gathered comps + reasoning into the structured Pricing output. */
export function buildPricingFinalPrompt(input: PricingInput, gatheredComps: string, agentNotes: string): string {
  return `Produce the final pricing for the ${input.category} in ${input.city} (quality ${input.qualityScore}/100).

COMPARABLES YOU RETRIEVED VIA YOUR TOOLS:
${gatheredComps || "(no comps were found)"}

YOUR WORKING NOTES:
${agentNotes}

Ground the price in this evidence: set suggested/min/max in the country's currency, list the comparableIds you
used, the priceFactors, the dataQuality (none/thin/adequate/strong), a justification referencing the comp
values, confidence (0-1, lower if comps are thin), and your reasoning (mention if you broadened the search).
Also set locationFactor (what locationIntel implied, or 'not checked') and demandFactor (what seasonalDemand
implied, or 'not checked').`;
}
