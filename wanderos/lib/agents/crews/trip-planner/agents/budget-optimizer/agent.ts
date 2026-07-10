import { invokeStructured } from "@/lib/ai/structured";
import { BudgetAllocation, BudgetPlanSchema, TripPlanItem } from "../../schemas";
import { buildBudgetOptimizerPrompt } from "./prompt";
import {
  BudgetAdvisorSchema,
  BudgetOptimizerInput,
  BudgetOptimizerInputSchema,
  BudgetOptimizerResult,
  BudgetOptimizerResultSchema
} from "./schema";

function parseDate(value?: string) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stayNights(input: BudgetOptimizerInput) {
  const start = parseDate(input.brief.startDate);
  const end = parseDate(input.brief.endDate);
  if (!start || !end || end.getTime() <= start.getTime()) return Math.max(1, input.dayArchitecture.days.length - 1);
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
}

function travelerCount(input: BudgetOptimizerInput) {
  return input.profile.travelerCount || 1;
}

function clean(value: string, max = 240) {
  return value.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

function amount(value: unknown) {
  const number = typeof value === "number" ? value : Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function isFood(item: TripPlanItem) {
  const text = `${item.category || ""} ${item.title}`.toLowerCase();
  return ["food", "lunch", "dinner", "ramen", "cafe", "market"].some((token) => text.includes(token));
}

function isFreeFlow(item: TripPlanItem) {
  const text = `${item.category || ""} ${item.title}`.toLowerCase();
  return ["walk", "rest", "logistics"].some((token) => text.includes(token));
}

function transitPerPerson(input: BudgetOptimizerInput) {
  if (input.profile.budgetBand === "luxury") return 35;
  if (input.profile.budgetBand === "premium") return 22;
  if (input.profile.budgetBand === "budget") return 8;
  return 12;
}

function budgetFit(total: number, budget?: number) {
  if (!budget || budget <= 0) return "unknown" as const;
  if (total <= budget * 0.9) return "fit" as const;
  if (total <= budget) return "near_limit" as const;
  return "over_budget" as const;
}

function allocation(category: string, amountValue: number, reason: string): BudgetAllocation {
  return { category, amount: Math.round(amountValue), reason };
}

function deterministicBudget(input: BudgetOptimizerInput): BudgetOptimizerResult {
  const nights = stayNights(input);
  const people = travelerCount(input);
  const primaryStay = input.stayRecommendations[0];
  const stayTotal = amount(primaryStay?.pricePerNight) * nights;

  const foodTotal = input.items.filter(isFood).reduce((sum, item) => sum + amount(item.estCost), 0);
  const activityTotal = input.items
    .filter((item) => !isFood(item) && !isFreeFlow(item))
    .reduce((sum, item) => sum + amount(item.estCost), 0);
  const transitTotal = input.dayArchitecture.days.length * people * transitPerPerson(input);
  const total = Math.round(stayTotal + foodTotal + activityTotal + transitTotal);
  const budget = input.profile.budget ?? input.brief.budget;
  const fit = budgetFit(total, budget);

  const warnings: string[] = [];
  const swapSuggestions: string[] = [];

  if (!primaryStay) warnings.push("No real stay recommendation is attached, so stay budget is incomplete.");
  if (!budget) warnings.push("No traveler budget was provided, so budget fit is unknown.");
  if (fit === "near_limit") warnings.push("Projected total is close to the stated budget; keep a small cash buffer.");
  if (fit === "over_budget") {
    warnings.push("Projected total is above the stated budget.");
    swapSuggestions.push("Choose a lower nightly stay or reduce paid activities before cutting core destination anchors.");
  }
  if (foodTotal > activityTotal && foodTotal > 0) swapSuggestions.push("Use casual market meals for one food block to protect the activity budget.");
  if (activityTotal > 150) swapSuggestions.push("Swap one paid activity for a free walk, viewpoint, or neighborhood photo route.");

  return BudgetPlanSchema.parse({
    currency: primaryStay?.currency || "USD",
    totalEstimate: total,
    budgetFit: fit,
    allocations: [
      allocation("stay", stayTotal, primaryStay ? `${nights} night stay estimate from approved WanderOS listing.` : "No approved stay selected."),
      allocation("food", foodTotal, "Food estimates from curated itinerary items."),
      allocation("activities", activityTotal, "Paid activity estimates from curated itinerary items."),
      allocation("local transit", transitTotal, "Deterministic local transit buffer by day and traveler count.")
    ],
    warnings: warnings.map((warning) => clean(warning)),
    swapSuggestions: swapSuggestions.map((suggestion) => clean(suggestion))
  });
}

function mergeAdvice(plan: BudgetOptimizerResult, advice: unknown): BudgetOptimizerResult {
  const parsed = BudgetAdvisorSchema.parse(advice);
  return BudgetOptimizerResultSchema.parse({
    ...plan,
    warnings: [...plan.warnings, ...parsed.warnings.map((warning) => clean(warning))].slice(0, 10),
    swapSuggestions: [...plan.swapSuggestions, ...parsed.swapSuggestions.map((suggestion) => clean(suggestion))].slice(0, 10)
  });
}

/**
 * budget-optimizer agent - deterministic budget math with optional reasoning-tier advice.
 * The model cannot alter totals or allocations.
 */
export async function optimizeBudget(input: unknown): Promise<BudgetOptimizerResult> {
  const parsed = BudgetOptimizerInputSchema.parse(input);
  const deterministic = deterministicBudget(parsed);

  try {
    const advice = await invokeStructured(BudgetAdvisorSchema, buildBudgetOptimizerPrompt(parsed, deterministic), {
      tier: "reasoning",
      retries: 1
    });
    return mergeAdvice(deterministic, advice);
  } catch {
    return deterministic;
  }
}
