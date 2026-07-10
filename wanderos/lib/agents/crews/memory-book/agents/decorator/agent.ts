import { invokeStructured } from "@/lib/ai/structured";
import { buildDecoratorPrompt } from "./prompt";
import { DecoratorInputSchema, DecoratorResult, DecoratorResultSchema } from "./schema";
export async function decorateSpreads(input: unknown): Promise<DecoratorResult> {
  const parsed = DecoratorInputSchema.parse(input);
  const result = await invokeStructured(DecoratorResultSchema, buildDecoratorPrompt(parsed), { tier: "flash" });
  return DecoratorResultSchema.parse(result);
}
