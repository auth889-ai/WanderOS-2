import { z } from "zod";
export const TravelCardResultSchema = z.object({
  summary: z.string(),
  triggers: z.array(z.object({ title: z.string(), body: z.string() })).max(4),
  festivals: z.array(z.object({ name: z.string(), when: z.string().optional(), why: z.string() })).max(6)
});
export type TravelCardResult = z.infer<typeof TravelCardResultSchema>;
