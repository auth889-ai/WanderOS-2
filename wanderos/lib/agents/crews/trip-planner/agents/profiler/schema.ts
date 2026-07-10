import type { z } from "zod";
import { ProfilerOutputSchema, TripBriefSchema } from "../../schemas";

/**
 * profiler - input/output contract.
 * Turns traveler intake into planning constraints and a retrieval query. It does not create itinerary
 * days, prices, activities, listing ids, or bookings.
 */

export const ProfilerInputSchema = TripBriefSchema;
export const ProfilerResultSchema = ProfilerOutputSchema;

export type ProfilerInput = z.infer<typeof ProfilerInputSchema>;
export type ProfilerResult = z.infer<typeof ProfilerResultSchema>;
