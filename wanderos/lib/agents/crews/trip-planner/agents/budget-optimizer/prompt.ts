import type { BudgetOptimizerResult } from "./schema";
import type { BudgetOptimizerInput } from "./schema";

export function buildBudgetOptimizerPrompt(input: BudgetOptimizerInput, plan: BudgetOptimizerResult): string {
  return `You are the budget-optimizer advisor for WanderOS Trip Planner.

The deterministic service already calculated the budget math below. Do NOT change totals, amounts, prices, or fit.
Your job is only to produce practical warnings and swap suggestions for the traveler.

Return JSON matching:
{
  "warnings": ["short warning"],
  "swapSuggestions": ["short swap suggestion"],
  "reasoning": "short explanation"
}

Traveler:
- destination: ${input.brief.destination}
- dates: ${input.brief.startDate || "(unknown)"} to ${input.brief.endDate || "(unknown)"}
- party: ${input.profile.party}
- travelerCount: ${input.profile.travelerCount ?? "(unknown)"}
- budget: ${input.profile.budget ?? input.brief.budget ?? "(unknown)"}
- budgetBand: ${input.profile.budgetBand || "(unknown)"}
- pace: ${input.profile.pace}
- constraints: ${JSON.stringify(input.profile.constraints || {}, null, 2)}

Deterministic budget plan:
${JSON.stringify(plan, null, 2)}

Items:
${JSON.stringify(input.items.map((item) => ({
  dayNumber: item.dayNumber,
  title: item.title,
  category: item.category,
  estCost: item.estCost
})), null, 2)}

Rules:
- Do not invent live prices or discounts.
- Do not mention flights; this budget covers stay, food, activities, and local transit only.
- If over budget, suggest concrete swaps like free viewpoints, fewer paid museums, cheaper food blocks, or lower-cost stay.
- If fit, mention useful budget guardrails, not fake certainty.`;
}
