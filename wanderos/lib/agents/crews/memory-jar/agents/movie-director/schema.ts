import { z } from "zod";
export const MovieDirectorResultSchema = z.object({
  title: z.string(),          // cinematic film title, e.g. "Chasing Horizons"
  logline: z.string(),        // one evocative line under the title
  starringLine: z.string(),   // "Starring {Name}"
  emotion: z.string(),        // the film's dominant feeling
  narrationHint: z.string(),  // guidance for the voiceover (warm, second-person, about THEIR journey)
  creditLine: z.string()      // "Directed by {Name}"
});
export type MovieDirectorResult = z.infer<typeof MovieDirectorResultSchema>;
