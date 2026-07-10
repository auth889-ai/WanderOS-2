import { invokeStructured } from "@/lib/ai/structured";
import { buildTaggerPrompt } from "./prompt";
import { TaggerInputSchema, TaggerResult, TaggerResultSchema } from "./schema";

export async function tagSocialPost(input: unknown): Promise<TaggerResult> {
  const parsed = TaggerInputSchema.parse(input);
  const result = await invokeStructured(TaggerResultSchema, buildTaggerPrompt(parsed), { tier: "flash" });
  return TaggerResultSchema.parse(result);
}
