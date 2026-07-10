import { invokeStructured } from "@/lib/ai/structured";
import { buildCardComposerPrompt } from "./prompt";
import { TravelCardResult, TravelCardResultSchema } from "./schema";
export async function composeTravelCards(ctx: Parameters<typeof buildCardComposerPrompt>[0]): Promise<TravelCardResult> {
  return TravelCardResultSchema.parse(await invokeStructured(TravelCardResultSchema, buildCardComposerPrompt(ctx), { tier: "reasoning" }));
}
