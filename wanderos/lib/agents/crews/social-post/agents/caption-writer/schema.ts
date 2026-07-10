import { z } from "zod";

export const CaptionWriterInputSchema = z.object({
  title: z.string(),
  existingCaption: z.string().nullable().optional(),
  existingBody: z.string().nullable().optional(),
  destination: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  verifiedStay: z.boolean(),
  listingId: z.string().nullable().optional(),
  bookingId: z.string().nullable().optional(),
  visualSummary: z.string(),
  vibe: z.string(),
  placeClues: z.array(z.string()),
  honestyNotes: z.array(z.string())
});

export const CaptionWriterResultSchema = z.object({
  caption: z.string().min(1).max(2000),
  body: z.string().min(1).max(10000),
  highlights: z.array(z.string().min(1).max(180)).min(1).max(6),
  aiSummary: z.string().min(1).max(1000),
  reasoning: z.string().min(1).max(1000)
});

export type CaptionWriterInput = z.infer<typeof CaptionWriterInputSchema>;
export type CaptionWriterResult = z.infer<typeof CaptionWriterResultSchema>;
