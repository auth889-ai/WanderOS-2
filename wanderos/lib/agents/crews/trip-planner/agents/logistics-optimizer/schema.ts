import { z } from "zod";
import {
  DayArchitectureSchema,
  DestinationIntelligenceSchema,
  ProfilerOutputSchema,
  StayRecommendationSchema,
  TripBriefSchema,
  TripPlanItemSchema
} from "../../schemas";

/**
 * logistics-optimizer - input/output contract.
 * Reorders and lightly refines existing activity candidates for practical day flow.
 * It does not create bookings, guarantee transit times, change day counts, or persist rows.
 */

export const LogisticsOptimizerInputSchema = z.object({
  brief: TripBriefSchema,
  profile: ProfilerOutputSchema,
  destinationIntel: DestinationIntelligenceSchema,
  stayRecommendations: z.array(StayRecommendationSchema).default([]),
  dayArchitecture: DayArchitectureSchema,
  items: z.array(TripPlanItemSchema).min(1)
});

export const LogisticsOptimizerResultSchema = z.object({
  items: z.array(TripPlanItemSchema).min(1),
  warnings: z.array(z.string().trim().max(240)).default([]),
  reasoning: z.string().trim().max(1200).optional()
});

export type LogisticsOptimizerInput = z.infer<typeof LogisticsOptimizerInputSchema>;
export type LogisticsOptimizerResult = z.infer<typeof LogisticsOptimizerResultSchema>;
