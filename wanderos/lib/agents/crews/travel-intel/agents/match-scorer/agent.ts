import { invokeStructured } from "@/lib/ai/structured";
import { buildMatchScorerPrompt } from "./prompt";
import { MatchScorerResult, MatchScorerResultSchema } from "./schema";
export async function scoreMatches(input: Parameters<typeof buildMatchScorerPrompt>[0]): Promise<MatchScorerResult> {
  if (!input.candidates.length) return { scored: [] };
  return MatchScorerResultSchema.parse(await invokeStructured(MatchScorerResultSchema, buildMatchScorerPrompt(input), { tier: "flash" }));
}
