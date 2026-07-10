import { z } from "zod";
import {
  DayArchitectureSchema,
  DestinationIntelligenceSchema,
  ProfilerOutputSchema,
  TripBriefSchema,
  TripPlanItemSchema
} from "../../schemas";

/**
 * item-evidence-writer - turns provider evidence into traveler-facing explanations.
 * It does not choose activities, change dates, invent prices, or persist rows.
 */

export const ItemEvidenceWriterInputSchema = z.object({
  brief: TripBriefSchema,
  profile: ProfilerOutputSchema,
  destinationIntel: DestinationIntelligenceSchema,
  dayArchitecture: DayArchitectureSchema,
  items: z.array(TripPlanItemSchema).min(1)
});

export const ItemEvidenceTextSchema = z.object({
  dayNumber: z.number().int().min(1).max(31),
  title: z.string().trim().min(1).max(140),
  description: z.string().trim().min(40).max(700),
  selectionRationale: z.string().trim().min(60).max(700),
  timingRationale: z.string().trim().min(40).max(500),
  costRationale: z.string().trim().min(40).max(500),
  travelerTip: z.string().trim().min(20).max(240),
  verificationNote: z.string().trim().min(20).max(240)
});

export const ItemEvidenceWriterResultSchema = z.object({
  items: z.array(ItemEvidenceTextSchema).min(1),
  reasoning: z.string().trim().min(20).max(1200)
});

export type ItemEvidenceWriterInput = z.infer<typeof ItemEvidenceWriterInputSchema>;
export type ItemEvidenceWriterResult = z.infer<typeof ItemEvidenceWriterResultSchema>;
