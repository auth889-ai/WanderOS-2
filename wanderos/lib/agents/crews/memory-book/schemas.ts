import { z } from "zod";

/** One source photo for the book — already carries a text description (from the post's AI caption /
 *  ai_description) so the curator/narrator don't need to re-run raw vision. */
export const MemorySourceSchema = z.object({
  url: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  date: z.string().optional(),
  source: z.enum(["post", "upload", "user"]).default("post")
});
export type MemorySource = z.infer<typeof MemorySourceSchema>;

/** Input to the whole crew (assembled by the worker from posts + uploads + user text). */
export const MemoryBuildInputSchema = z.object({
  bookId: z.string(),
  travelerId: z.string(),
  tripId: z.string().nullable().optional(),
  title: z.string().optional(),
  userText: z.string().optional(),
  tripContext: z.string().optional(),
  photos: z.array(MemorySourceSchema)
});
export type MemoryBuildInput = z.infer<typeof MemoryBuildInputSchema>;
