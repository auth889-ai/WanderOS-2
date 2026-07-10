import { z } from "zod";
import { DestinationIntelligenceSchema, ProfilerOutputSchema, StayRecommendationSchema, TripBriefSchema } from "../../schemas";

/**
 * stay-matcher - input/output contract.
 * Retrieves real approved WanderOS listings, then allows the model to rank/explain only those candidates.
 * It does not invent stays, create bookings, write itinerary rows, or persist anything.
 */

export const StayMatcherInputSchema = z.object({
  brief: TripBriefSchema,
  profile: ProfilerOutputSchema,
  destinationIntel: DestinationIntelligenceSchema.optional()
});

export const StayCandidateSchema = z.object({
  listingId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  city: z.string().trim().max(120),
  country: z.string().trim().max(120),
  category: z.string().trim().max(80),
  pricePerNight: z.number().min(0),
  maxGuests: z.number().int().min(1).nullable(),
  tags: z.array(z.string()).default([]),
  amenities: z.array(z.string()).default([]),
  similarity: z.number().min(0).max(1),
  deterministicScore: z.number().min(0).max(1),
  source: z.enum(["pgvector", "aurora"])
});

export const StayRankPickSchema = z.object({
  listingId: z.string().uuid(),
  matchScore: z.number().min(0).max(1),
  why: z.string().trim().max(500).default("")
});

export const StayRankerOutputSchema = z.object({
  picks: z.array(StayRankPickSchema).max(3),
  reasoning: z.string().trim().max(900)
});

export const StayMatcherResultSchema = z.object({
  recommendations: z.array(StayRecommendationSchema).max(3),
  retrieval: z.object({
    query: z.string().trim().min(1).max(400),
    retrievedCount: z.number().int().min(0),
    candidateCount: z.number().int().min(0),
    sourceIds: z.array(z.string()).default([]),
    warnings: z.array(z.string()).default([])
  }),
  reasoning: z.string().trim().max(900)
});

export type StayMatcherInput = z.infer<typeof StayMatcherInputSchema>;
export type StayCandidate = z.infer<typeof StayCandidateSchema>;
export type StayRankerOutput = z.infer<typeof StayRankerOutputSchema>;
export type StayMatcherResult = z.infer<typeof StayMatcherResultSchema>;
