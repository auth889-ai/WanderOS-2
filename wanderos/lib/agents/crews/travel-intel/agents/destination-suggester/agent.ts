import { invokeStructured } from "@/lib/ai/structured";
import { buildSuggesterPrompt } from "./prompt";
import { SuggesterResult, SuggesterResultSchema } from "./schema";
export async function suggestDestinations(ctx: Parameters<typeof buildSuggesterPrompt>[0]): Promise<SuggesterResult> {
  return SuggesterResultSchema.parse(await invokeStructured(SuggesterResultSchema, buildSuggesterPrompt(ctx), { tier: "reasoning" }));
}
