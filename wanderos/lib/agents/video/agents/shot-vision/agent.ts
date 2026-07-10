import { invokeStructuredVision } from "@/lib/ai/structured";
import { PerceivedSchema, type Perceived } from "./schema";
import { buildShotVisionPrompt } from "./prompt";

/** Agent 1 · shot-vision — perceives each photo (room · features · camera move).
 *  Uses the "pro" vision tier (reliable structured JSON), falls back to "flash". */
export async function runShotVision(photoUrls: string[]): Promise<Perceived> {
  const prompt = buildShotVisionPrompt(photoUrls.length);
  try {
    return await invokeStructuredVision(PerceivedSchema, prompt, photoUrls, { tier: "pro" });
  } catch {
    return await invokeStructuredVision(PerceivedSchema, prompt, photoUrls, { tier: "flash" });
  }
}
