import { invokeStructured } from "@/lib/ai/structured";
import { buildPredictorPrompt } from "./prompt";
import { PredictorResult, PredictorResultSchema } from "./schema";
export async function predictExperience(ctx: Parameters<typeof buildPredictorPrompt>[0]): Promise<PredictorResult> {
  return PredictorResultSchema.parse(await invokeStructured(PredictorResultSchema, buildPredictorPrompt(ctx), { tier: "reasoning" }));
}
