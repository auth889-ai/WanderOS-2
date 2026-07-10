import { invokeStructured } from "@/lib/ai/structured";
import { buildNarrativeWriterPrompt } from "./prompt";
import { NarrativeWriterInputSchema, NarrativeWriterResult, NarrativeWriterResultSchema } from "./schema";
export async function writeNarrative(input: unknown): Promise<NarrativeWriterResult> {
  const parsed = NarrativeWriterInputSchema.parse(input);
  const result = await invokeStructured(NarrativeWriterResultSchema, buildNarrativeWriterPrompt(parsed), { tier: "reasoning" });
  return NarrativeWriterResultSchema.parse(result);
}
