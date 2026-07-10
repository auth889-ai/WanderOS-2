import { z } from "zod";
import {
  DayArchitectureSchema,
  DestinationIntelligenceSchema,
  ProfilerOutputSchema,
  StayRecommendationSchema,
  TripBriefSchema
} from "../../schemas";

/**
 * day-architect - input/output contract.
 * Creates day-level planning structure only: day count, dates, theme, area, energy, item target.
 * It does not create activities, prices, bookings, listing ids, or persisted rows.
 */

export const DayArchitectInputSchema = z.object({
  brief: TripBriefSchema,
  profile: ProfilerOutputSchema,
  destinationIntel: DestinationIntelligenceSchema,
  stayRecommendations: z.array(StayRecommendationSchema).default([])
});

export const DayArchitectResultSchema = DayArchitectureSchema;

export type DayArchitectInput = z.infer<typeof DayArchitectInputSchema>;
export type DayArchitectResult = z.infer<typeof DayArchitectResultSchema>;
