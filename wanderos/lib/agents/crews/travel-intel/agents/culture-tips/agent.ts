import { invokeStructured } from "@/lib/ai/structured";
import { buildCultureTipsPrompt } from "./prompt";
import { CultureTipsResult, CultureTipsResultSchema } from "./schema";
export async function getCultureTips(destination: string, country: string, weather?: string): Promise<CultureTipsResult> {
  return CultureTipsResultSchema.parse(await invokeStructured(CultureTipsResultSchema, buildCultureTipsPrompt(destination, country, weather), { tier: "flash" }));
}
