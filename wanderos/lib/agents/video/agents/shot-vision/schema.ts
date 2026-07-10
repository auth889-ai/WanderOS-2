import { z } from "zod";

/** shot-vision output — what the crew's EYE perceives in each photo (no scripting/ordering here). */
export const PerceivedSchema = z.object({
  shots: z.array(
    z.object({
      photoIndex: z.number().int(),
      room: z.string().describe("what is actually shown: bedroom, bathroom, living room, kitchen, balcony, pool, exterior, view…"),
      features: z.array(z.string()).describe("2-4 visible highlights"),
      motionHint: z.string().describe("a fitting camera move: slow dolly-in · pan · push to window · tilt up")
    })
  )
});
export type Perceived = z.infer<typeof PerceivedSchema>;
