import { invokeStructured } from "@/lib/ai/structured";
import { PropertyProfileSchema, PropertyProfile, AggregatorInput } from "./schema";
import { buildAggregatorPrompt } from "./prompt";

/**
 * vision-aggregator agent — merges all per-photo analyses into one property profile.
 *
 * Pure synthesis (no external tool): the grounding is the real per-photo data from
 * property-vision. It cross-references photos, finds coverage gaps, flags contradictions, and
 * weights overall quality. "pro" tier — this is reasoning over multiple inputs.
 */
export async function visionAggregator(input: AggregatorInput): Promise<PropertyProfile> {
  return invokeStructured(PropertyProfileSchema, buildAggregatorPrompt(input), { tier: "pro" });
}
