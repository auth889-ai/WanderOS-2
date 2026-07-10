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
 * activity-curator - input/output contract.
 * Creates editable itinerary item candidates for the day architecture.
 * It does not persist rows, book stays, write listing ids, or perform budget optimization.
 */

export const ActivityCuratorInputSchema = z.object({
  brief: TripBriefSchema,
  profile: ProfilerOutputSchema,
  destinationIntel: DestinationIntelligenceSchema,
  stayRecommendations: z.array(StayRecommendationSchema).default([]),
  dayArchitecture: DayArchitectureSchema
});

export const ActivityCuratorResultSchema = z.object({
  items: z.array(TripPlanItemSchema).min(1),
  reasoning: z.string().trim().max(1200).optional()
});

export const ItineraryDesignerInputSchema = z.object({
  brief: TripBriefSchema,
  profile: ProfilerOutputSchema,
  destinationIntel: DestinationIntelligenceSchema,
  stayRecommendations: z.array(StayRecommendationSchema).default([])
});

export const ItineraryDesignerResultSchema = z.object({
  dayArchitecture: DayArchitectureSchema,
  items: z.array(TripPlanItemSchema).min(1),
  warnings: z.array(z.string().trim().max(240)).default([]),
  reasoning: z.string().trim().max(1600).optional()
});

export type ActivityCuratorInput = z.infer<typeof ActivityCuratorInputSchema>;
export type ActivityCuratorResult = z.infer<typeof ActivityCuratorResultSchema>;
export type ItineraryDesignerInput = z.infer<typeof ItineraryDesignerInputSchema>;
export type ItineraryDesignerResult = z.infer<typeof ItineraryDesignerResultSchema>;
