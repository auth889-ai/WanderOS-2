import { z } from "zod";
export const NarrativeWriterInputSchema = z.object({
  title: z.string().optional(),
  tripContext: z.string().optional(),
  userText: z.string().optional(),
  chapters: z.array(z.object({
    title: z.string(),
    vibe: z.string(),
    photos: z.array(z.object({ index: z.number(), description: z.string() }))
  }))
});
export const NarrativeWriterResultSchema = z.object({
  bookTitle: z.string(),
  theme: z.enum(["vintage", "cherry-blossom", "whimsical-dream", "sunset-coast", "mono-minimal"]),
  chapters: z.array(z.object({
    title: z.string(),
    story: z.string(),
    captions: z.array(z.object({ photoIndex: z.number(), caption: z.string() })),
    quote: z.string().optional()
  }))
});
export type NarrativeWriterInput = z.infer<typeof NarrativeWriterInputSchema>;
export type NarrativeWriterResult = z.infer<typeof NarrativeWriterResultSchema>;
