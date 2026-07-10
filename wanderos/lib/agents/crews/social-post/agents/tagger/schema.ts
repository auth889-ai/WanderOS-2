import { z } from "zod";

export const TaggerInputSchema = z.object({
  caption: z.string(),
  body: z.string(),
  destination: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  existingTags: z.array(z.string()).default([]),
  visualSummary: z.string(),
  highlights: z.array(z.string())
});

export const TaggerResultSchema = z.object({
  mood: z.string().min(1).max(80),
  tags: z.array(z.string().min(1).max(40)).min(1).max(12),
  destination: z.string().max(120).nullable(),
  locationLabel: z.string().max(160).nullable(),
  reasoning: z.string().min(1).max(800)
});

export type TaggerInput = z.infer<typeof TaggerInputSchema>;
export type TaggerResult = z.infer<typeof TaggerResultSchema>;
