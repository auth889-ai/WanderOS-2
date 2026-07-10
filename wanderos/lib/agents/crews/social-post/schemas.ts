import { z } from "zod";

export const SocialPostMediaSchema = z.object({
  id: z.string().uuid().optional(),
  mediaUrl: z.string().url(),
  mediaKind: z.enum(["photo", "video", "reel"]),
  aiDescription: z.string().nullable().optional()
});

export const SocialPostCrewInputSchema = z.object({
  postId: z.string().uuid(),
  authorId: z.string().uuid(),
  title: z.string().min(1),
  caption: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  destination: z.string().nullable().optional(),
  mood: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  listingId: z.string().uuid().nullable().optional(),
  bookingId: z.string().uuid().nullable().optional(),
  verifiedStay: z.boolean().default(false),
  media: z.array(SocialPostMediaSchema).default([])
});

export type SocialPostCrewInput = z.infer<typeof SocialPostCrewInputSchema>;

export const SocialPostCrewResultSchema = z.object({
  caption: z.string().min(1).max(2000),
  body: z.string().max(10000).nullable(),
  mood: z.string().min(1).max(80),
  tags: z.array(z.string().min(1).max(40)).max(12),
  destination: z.string().max(120).nullable(),
  aiSummary: z.string().min(1).max(1000),
  moderationStatus: z.enum(["pending_review", "approved", "rejected", "blocked"]),
  moderationReport: z.record(z.unknown()),
  embedded: z.boolean()
});

export type SocialPostCrewResult = z.infer<typeof SocialPostCrewResultSchema>;
