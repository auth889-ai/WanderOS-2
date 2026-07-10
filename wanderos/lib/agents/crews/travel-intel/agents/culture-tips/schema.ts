import { z } from "zod";
export const CultureTipsResultSchema = z.object({
  bestTime: z.string(),
  gettingAround: z.string(),
  etiquette: z.array(z.string()).max(4),
  safety: z.string(),
  moneyTip: z.string(),
  dontMiss: z.string()
});
export type CultureTipsResult = z.infer<typeof CultureTipsResultSchema>;
