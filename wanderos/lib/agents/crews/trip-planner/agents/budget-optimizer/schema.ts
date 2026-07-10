import { z } from "zod";
import {
  BudgetPlanSchema,
  DayArchitectureSchema,
  ProfilerOutputSchema,
  StayRecommendationSchema,
  TripBriefSchema,
  TripPlanItemSchema
} from "../../schemas";

/**
 * budget-optimizer - input/output contract.
 * Deterministic code owns budget math. The model may only explain warnings and swap suggestions.
 */

export const BudgetOptimizerInputSchema = z.object({
  brief: TripBriefSchema,
  profile: ProfilerOutputSchema,
  stayRecommendations: z.array(StayRecommendationSchema).default([]),
  dayArchitecture: DayArchitectureSchema,
  items: z.array(TripPlanItemSchema).min(1)
});

export const BudgetAdvisorSchema = z.object({
  warnings: z.array(z.string().trim().max(240)).max(10).default([]),
  swapSuggestions: z.array(z.string().trim().max(240)).max(10).default([]),
  reasoning: z.string().trim().max(1000).optional()
});

export const BudgetOptimizerResultSchema = BudgetPlanSchema;

export type BudgetOptimizerInput = z.infer<typeof BudgetOptimizerInputSchema>;
export type BudgetAdvisor = z.infer<typeof BudgetAdvisorSchema>;
export type BudgetOptimizerResult = z.infer<typeof BudgetOptimizerResultSchema>;
