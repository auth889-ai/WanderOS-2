import { z } from "zod";
export const DecoratorInputSchema = z.object({
  theme: z.string(),
  spreads: z.array(z.object({ index: z.number(), vibe: z.string() }))
});
export const DecoratorResultSchema = z.object({
  spreads: z.array(z.object({
    spreadIndex: z.number(),
    decorations: z.array(z.object({
      variant: z.string(),                       // washi | tape | stamp | blossom | star | leaf | heart
      emoji: z.string().optional(),
      side: z.enum(["left", "right"]),
      xRatio: z.number(), yRatio: z.number(),    // 0..1 of the page
      rotation: z.number().default(0)
    }))
  }))
});
export type DecoratorInput = z.infer<typeof DecoratorInputSchema>;
export type DecoratorResult = z.infer<typeof DecoratorResultSchema>;
