import { z } from "zod";
export const MatchScorerInputSchema = z.object({
  profile: z.object({ budget: z.string().optional(), interests: z.array(z.string()), travelStyle: z.string().optional() }),
  candidates: z.array(z.object({ name: z.string(), kind: z.string(), hint: z.string().optional() }))
});
export const MatchScorerResultSchema = z.object({
  scored: z.array(z.object({ name: z.string(), score: z.number().min(0).max(100), reason: z.string() }))
});
export type MatchScorerResult = z.infer<typeof MatchScorerResultSchema>;
