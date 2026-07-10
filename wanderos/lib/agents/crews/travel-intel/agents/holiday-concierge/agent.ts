import { invokeStructured } from "@/lib/ai/structured";
import { buildHolidayConciergePrompt } from "./prompt";
import { HolidayConciergeResult, HolidayConciergeResultSchema } from "./schema";
export async function getHolidayConcierge(ctx: Parameters<typeof buildHolidayConciergePrompt>[0]): Promise<HolidayConciergeResult> {
  return HolidayConciergeResultSchema.parse(await invokeStructured(HolidayConciergeResultSchema, buildHolidayConciergePrompt(ctx), { tier: "reasoning" }));
}
