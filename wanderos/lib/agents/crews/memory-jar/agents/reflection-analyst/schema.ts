import { z } from "zod";
export const ReflectionResultSchema = z.object({
  growthLine: z.string(),         // how the traveler has changed
  prediction: z.string(),         // AI predictive reflection — where they're heading / how they'll grow
  futureSelfMessage: z.string(),  // a warm message to deliver to their future self
  themes: z.array(z.string()).max(5)
});
export type ReflectionResult = z.infer<typeof ReflectionResultSchema>;
