import { z } from "zod";

/** caption-writer output — punchy on-screen caption per shot. */
export const CaptionsSchema = z.object({
  captions: z.array(z.object({ photoIndex: z.number().int(), caption: z.string().max(60) }))
});
export type Captions = z.infer<typeof CaptionsSchema>;
