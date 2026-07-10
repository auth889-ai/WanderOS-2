import { ModelTier } from "@/lib/ai/llm";
import { invokeStructured } from "@/lib/ai/structured";
import { buildModerationPrompt } from "./prompt";
import { ModerationInputSchema, ModerationResult, ModerationResultSchema } from "./schema";

export async function moderateSocialPost(input: unknown): Promise<ModerationResult> {
  const parsed = ModerationInputSchema.parse(input);
  const tier = ((process.env.SOCIAL_MODERATION_TIER as ModelTier | undefined) ?? "flash") as ModelTier;
  const result = await invokeStructured(ModerationResultSchema, buildModerationPrompt(parsed), { tier, retries: 1 });
  return ModerationResultSchema.parse(result);
}
