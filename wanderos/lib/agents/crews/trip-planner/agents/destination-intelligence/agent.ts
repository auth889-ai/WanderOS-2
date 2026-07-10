import { invokeStructured } from "@/lib/ai/structured";
import { buildDestinationIntelligencePrompt } from "./prompt";
import {
  DestinationIntelligenceInputSchema,
  DestinationIntelligenceResult,
  DestinationIntelligenceResultSchema
} from "./schema";

/**
 * destination-intelligence agent - second trip planner crew node.
 * Uses the pro tier because this is destination synthesis, not simple extraction.
 */
export async function destinationIntelligence(input: unknown): Promise<DestinationIntelligenceResult> {
  const parsed = DestinationIntelligenceInputSchema.parse(input);
  const result = await invokeStructured(DestinationIntelligenceResultSchema, buildDestinationIntelligencePrompt(parsed), {
    tier: "pro"
  });
  return DestinationIntelligenceResultSchema.parse(result);
}
