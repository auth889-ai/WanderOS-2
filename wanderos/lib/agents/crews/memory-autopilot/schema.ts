import { z } from "zod";

/** Typed contracts for the Autopilot brain — every LLM output validates against these. */

export const InferredTripSchema = z.object({
  destination: z.string().min(1),
  tripType: z.string().default("trip"),
  tone: z.string().default("warm, nostalgic, cinematic"),
  language: z.string().default("English"),
  confidence: z.number().min(0).max(1)
});
export type InferredTrip = z.infer<typeof InferredTripSchema>;

export const SceneSchema = z.object({
  idx: z.number().int(),
  source: z.enum(["original", "parallax", "gen_image", "hero_video", "synthetic_scene"]),
  assetKey: z.string().nullable().default(null),
  genPrompt: z.string().nullable().default(null),
  motionPrompt: z.string(),
  narrationLine: z.string(),
  durationSec: z.number().int().min(3).max(8).default(5),
  needsConsent: z.boolean().default(false),
  day: z.number().int().nullable().default(null)
});
export type Scene = z.infer<typeof SceneSchema>;

export const StoryboardSchema = z.object({
  title: z.string().min(2),
  arc: z.string(),
  musicMood: z.string(),
  narrationFull: z.string(),
  scenes: z.array(SceneSchema).min(3).max(8)
});
export type Storyboard = z.infer<typeof StoryboardSchema>;

export type GapProposal = {
  rule: string;
  day: number;
  description: string;
  proposal: { type: string; prompt: string; needs_consent: boolean };
};

export type AutopilotState = {
  jobId: string;
  requestText: string;
  assetKeys: string[];
  inferred: InferredTrip | null;
  timeline: unknown | null;
  gaps: GapProposal[];
  storyboard: Storyboard | null;
  approval: { decision: string; consents?: Record<number, boolean> } | null;
};
