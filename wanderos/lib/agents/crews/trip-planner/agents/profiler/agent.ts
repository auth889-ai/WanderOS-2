import { invokeStructured } from "@/lib/ai/structured";
import { buildProfilerPrompt } from "./prompt";
import { ProfilerInputSchema, ProfilerResult, ProfilerResultSchema } from "./schema";

/**
 * profiler agent - first real AI crew node.
 * Uses the extract tier because this is classification/normalization, not creative itinerary writing.
 */
export async function profileTrip(input: unknown): Promise<ProfilerResult> {
  const brief = ProfilerInputSchema.parse(input);
  const result = await invokeStructured(ProfilerResultSchema, buildProfilerPrompt(brief), { tier: "extract" });
  return ProfilerResultSchema.parse(result);
}
