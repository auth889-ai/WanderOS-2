import { z } from "zod";
export const BudgetBreakdownResultSchema = z.object({
  feasible: z.boolean(),
  daysAffordable: z.number(),
  breakdown: z.object({ stay: z.string(), food: z.string(), activities: z.string(), transport: z.string() }),
  total: z.string(),
  summary: z.string(),
  tips: z.array(z.string()).max(3)
});
export type BudgetBreakdownResult = z.infer<typeof BudgetBreakdownResultSchema>;
