import { z } from "zod";
export const JarRecapResultSchema = z.object({
  topMoment: z.string(),
  mood: z.string(),                 // e.g. "Peaceful & Inspired"
  favoriteFeeling: z.string(),      // e.g. "Grateful"
  growthLine: z.string(),           // "You explored more, felt deeper, and became stronger."
  narration: z.string(),            // 2-3 sentence AI narrator voice-over
  emotionalWeather: z.enum(["cherry_blossom", "soft_rain", "golden_sunset", "temple_bells", "snow", "starlight"]),
  particleType: z.enum(["sakura", "rain", "sparks", "snow", "fireflies"]),
  glow: z.string()                  // hex glow color for the jar, e.g. "#c98bff"
});
export type JarRecapResult = z.infer<typeof JarRecapResultSchema>;
