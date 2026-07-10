import { invokeStructured } from "@/lib/ai/structured";
import { buildLayoutDesignerPrompt } from "./prompt";
import { LayoutDesignerInputSchema, LayoutDesignerResult, LayoutDesignerResultSchema } from "./schema";
export async function designLayouts(input: unknown): Promise<LayoutDesignerResult> {
  const parsed = LayoutDesignerInputSchema.parse(input);
  const result = await invokeStructured(LayoutDesignerResultSchema, buildLayoutDesignerPrompt(parsed), { tier: "flash" });
  return LayoutDesignerResultSchema.parse(result);
}
