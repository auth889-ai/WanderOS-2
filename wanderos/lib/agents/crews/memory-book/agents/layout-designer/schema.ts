import { z } from "zod";
export const LayoutDesignerInputSchema = z.object({
  theme: z.string(),
  templateKeys: z.array(z.string()),
  spreads: z.array(z.object({ index: z.number(), photoCount: z.number(), hasQuote: z.boolean(), isTitle: z.boolean() }))
});
export const LayoutDesignerResultSchema = z.object({
  layouts: z.array(z.object({ spreadIndex: z.number(), templateKey: z.string() }))
});
export type LayoutDesignerInput = z.infer<typeof LayoutDesignerInputSchema>;
export type LayoutDesignerResult = z.infer<typeof LayoutDesignerResultSchema>;
