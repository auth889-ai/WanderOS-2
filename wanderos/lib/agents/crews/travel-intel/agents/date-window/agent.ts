import { invokeStructured } from "@/lib/ai/structured";
import { buildDateWindowPrompt } from "./prompt";
import { DateWindowResult, DateWindowResultSchema } from "./schema";
export async function getDateWindowPlan(ctx: Parameters<typeof buildDateWindowPrompt>[0]): Promise<DateWindowResult> {
  return DateWindowResultSchema.parse(await invokeStructured(DateWindowResultSchema, buildDateWindowPrompt(ctx), { tier: "reasoning" }));
}
