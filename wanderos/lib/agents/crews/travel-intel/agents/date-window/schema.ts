import { z } from "zod";
export const DateWindowResultSchema = z.object({
  seasonNote: z.string(),
  bestPlaces: z.array(z.object({ name: z.string(), why: z.string() })).max(8),
  tips: z.string()
});
export type DateWindowResult = z.infer<typeof DateWindowResultSchema>;
