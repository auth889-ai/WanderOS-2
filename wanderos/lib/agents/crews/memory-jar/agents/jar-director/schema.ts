import { z } from "zod";
export const JarDirectorResultSchema = z.object({
  title: z.string(),                 // e.g. "Neon Nights of Tokyo"
  emotion: z.string(),               // dominant feeling captured
  scene: z.string()                  // a vivid visual scene description for the jar's inner diorama (fed to the image generator)
});
export type JarDirectorResult = z.infer<typeof JarDirectorResultSchema>;
