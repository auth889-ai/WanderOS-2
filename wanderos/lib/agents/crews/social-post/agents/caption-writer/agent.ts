import { invokeStructured } from "@/lib/ai/structured";
import { buildCaptionWriterPrompt } from "./prompt";
import { CaptionWriterInputSchema, CaptionWriterResult, CaptionWriterResultSchema } from "./schema";

export async function writeSocialCaption(input: unknown): Promise<CaptionWriterResult> {
  const parsed = CaptionWriterInputSchema.parse(input);
  const result = await invokeStructured(CaptionWriterResultSchema, buildCaptionWriterPrompt(parsed), { tier: "pro" });
  return CaptionWriterResultSchema.parse(result);
}
