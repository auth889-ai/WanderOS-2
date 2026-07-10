import { invokeStructured } from "@/lib/ai/structured";
import { ScriptSchema, type NarrationScript } from "./schema";
import { buildNarrationPrompt, type NarrationInput } from "./prompt";

/** Agent 3 · narration-writer — cohesive voice script (reasoning tier = best copy). */
export async function runNarrationWriter(input: NarrationInput): Promise<NarrationScript> {
  return invokeStructured(ScriptSchema, buildNarrationPrompt(input), { tier: "reasoning" });
}
