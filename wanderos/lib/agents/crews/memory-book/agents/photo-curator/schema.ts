import { z } from "zod";
export const PhotoCuratorInputSchema = z.object({
  photos: z.array(z.object({ index: z.number(), description: z.string(), location: z.string().optional(), date: z.string().optional() }))
});
export const PhotoCuratorResultSchema = z.object({
  chapters: z.array(z.object({
    title: z.string(),
    place: z.string().optional(),
    vibe: z.string(),
    photoIndexes: z.array(z.number())
  }))
});
export type PhotoCuratorInput = z.infer<typeof PhotoCuratorInputSchema>;
export type PhotoCuratorResult = z.infer<typeof PhotoCuratorResultSchema>;
