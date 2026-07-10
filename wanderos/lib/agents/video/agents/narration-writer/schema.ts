import { z } from "zod";

/** narration-writer output — one cohesive voice line per shot. */
export const ScriptSchema = z.object({
  title: z.string(),
  lines: z.array(z.object({ photoIndex: z.number().int(), narration: z.string() }))
});
export type NarrationScript = z.infer<typeof ScriptSchema>;
