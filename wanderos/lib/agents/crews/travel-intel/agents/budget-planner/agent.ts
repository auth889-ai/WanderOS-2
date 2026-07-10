import { invokeStructured } from "@/lib/ai/structured";
import { buildBudgetPrompt } from "./prompt";
import { BudgetBreakdownResult, BudgetBreakdownResultSchema } from "./schema";
export async function planBudget(ctx: Parameters<typeof buildBudgetPrompt>[0]): Promise<BudgetBreakdownResult> {
  return BudgetBreakdownResultSchema.parse(await invokeStructured(BudgetBreakdownResultSchema, buildBudgetPrompt(ctx), { tier: "reasoning" }));
}
