import { invokeStructured } from "@/lib/ai/structured";
import { buildReflectionPrompt } from "./prompt";
import { ReflectionResult, ReflectionResultSchema } from "./schema";
export async function analyzeReflection(ctx: Parameters<typeof buildReflectionPrompt>[0]): Promise<ReflectionResult> {
  return ReflectionResultSchema.parse(await invokeStructured(ReflectionResultSchema, buildReflectionPrompt(ctx), { tier: "reasoning" }));
}
