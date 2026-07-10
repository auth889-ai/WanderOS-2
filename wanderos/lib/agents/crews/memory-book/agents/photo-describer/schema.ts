import { z } from "zod";
export const PhotoDescriberInputSchema = z.object({ urls: z.array(z.string()).min(1).max(6) });
export const PhotoDescriberResultSchema = z.object({
  descriptions: z.array(z.object({ index: z.number(), description: z.string() }))
});
export type PhotoDescriberResult = z.infer<typeof PhotoDescriberResultSchema>;
