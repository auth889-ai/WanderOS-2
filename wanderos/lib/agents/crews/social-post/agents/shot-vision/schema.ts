import { z } from "zod";

export const ShotVisionInputSchema = z.object({
  title: z.string(),
  destination: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  media: z.array(
    z.object({
      mediaUrl: z.string().url(),
      mediaKind: z.enum(["photo", "video", "reel"])
    })
  )
});

export const ShotVisionResultSchema = z.object({
  visualSummary: z.string().min(1).max(1200),
  vibe: z.string().min(1).max(160),
  bestShots: z
    .array(
      z.object({
        mediaUrl: z.string().max(1000).default(""),
        reason: z.string().max(300).default("Selected as one of the strongest uploaded travel shots."),
        suggestedAltText: z.string().max(240).default("Traveler-uploaded trip photo.")
      })
    )
    .max(6),
  placeClues: z.array(z.string().min(1).max(120)).max(8),
  honestyNotes: z.array(z.string().min(1).max(1000)).max(8)
});

export type ShotVisionInput = z.infer<typeof ShotVisionInputSchema>;
export type ShotVisionResult = z.infer<typeof ShotVisionResultSchema>;
