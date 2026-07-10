import { invokeStructured } from "@/lib/ai/structured";
import { CaptionsSchema, type Captions } from "./schema";
import { buildCaptionPrompt } from "./prompt";

/** Agent 4 · caption-writer — punchy on-screen captions (flash tier). */
export async function runCaptionWriter(input: { orderedShots: { photoIndex: number; room: string }[] }): Promise<Captions> {
  return invokeStructured(CaptionsSchema, buildCaptionPrompt(input.orderedShots), { tier: "flash" });
}
