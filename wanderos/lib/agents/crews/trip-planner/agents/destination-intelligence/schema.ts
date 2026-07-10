import { z } from "zod";
import { DestinationIntelligenceSchema, ProfilerOutputSchema, TripBriefSchema } from "../../schemas";

/**
 * destination-intelligence - input/output contract.
 * Produces destination context for downstream planning. It does not create itinerary rows, listing ids,
 * live prices, bookings, or final schedules.
 */

export const DestinationIntelligenceInputSchema = z.object({
  brief: TripBriefSchema,
  profile: ProfilerOutputSchema
});

export const DestinationIntelligenceResultSchema = DestinationIntelligenceSchema;

export type DestinationIntelligenceInput = z.infer<typeof DestinationIntelligenceInputSchema>;
export type DestinationIntelligenceResult = z.infer<typeof DestinationIntelligenceResultSchema>;
