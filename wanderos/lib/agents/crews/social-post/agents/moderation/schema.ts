import { z } from "zod";

export const ModerationInputSchema = z.object({
  title: z.string(),
  caption: z.string(),
  body: z.string(),
  tags: z.array(z.string()),
  verifiedStay: z.boolean(),
  hasBookingId: z.boolean(),
  hasListingId: z.boolean(),
  visualSummary: z.string(),
  honestyNotes: z.array(z.string())
});

export const ModerationResultSchema = z.object({
  status: z.enum(["pending_review", "approved", "rejected", "blocked"]),
  reasons: z.array(z.string().min(1).max(1000)).max(10),
  privacyFlags: z.array(z.string().min(1).max(1000)).max(10),
  honestyNotes: z.array(z.string().min(1).max(1000)).max(10),
  requiredEdits: z.array(z.string().min(1).max(1000)).max(10)
});

export type ModerationInput = z.infer<typeof ModerationInputSchema>;
export type ModerationResult = z.infer<typeof ModerationResultSchema>;
