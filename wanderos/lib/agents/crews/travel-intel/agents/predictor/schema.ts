import { z } from "zod";
export const PredictorResultSchema = z.object({
  vibe: z.string(),
  crowdLevel: z.enum(["low", "medium", "high"]),
  weatherComfort: z.enum(["low", "medium", "high"]),
  regretRisk: z.enum(["low", "medium", "high"]),
  bestFor: z.string(),
  avoidIf: z.string()
});
export type PredictorResult = z.infer<typeof PredictorResultSchema>;
