import { z } from "zod";

/**
 * Trip planner schemas - canonical typed contracts for the AI itinerary crew.
 * Agents may produce these shapes, but only deterministic verifier/composer code can persist them.
 */

const nonEmpty = (label: string, max = 160) => z.string().trim().min(1, `${label} required`).max(max, `${label} too long`);
const money = z.number().min(0, "amount cannot be negative").refine(Number.isFinite, "amount must be finite");
const confidence = z.number().min(0).max(1).refine(Number.isFinite);
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
const stringFromUnknown = (value: unknown) => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((part) => typeof part === "string" || typeof part === "number").join(" ");
  if (value && typeof value === "object") {
    return Object.values(value)
      .flatMap((part) => (Array.isArray(part) ? part : [part]))
      .filter((part) => typeof part === "string" || typeof part === "number")
      .join(" ");
  }
  return "";
};
const retrievalQuery = z.preprocess((value) => stringFromUnknown(value), nonEmpty("query", 300));
const assetUrl = z.string().trim().max(800).refine(
  (value) => value.startsWith("/") || z.string().url().safeParse(value).success,
  "image must be an external URL or first-party public asset path"
);

export const TripPaceSchema = z.enum(["relaxed", "balanced", "packed"]);
export type TripPace = z.infer<typeof TripPaceSchema>;

export const TripBriefSchema = z.object({
  destination: nonEmpty("destination", 120),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  budget: money.optional(),
  travelStyle: z.string().trim().max(120).optional(),
  interests: z.array(nonEmpty("interest", 80)).max(12).default([]),
  party: z.string().trim().max(80).optional(),
  pace: TripPaceSchema.default("balanced"),
  constraints: z.record(z.unknown()).default({})
});
export type TripBrief = z.infer<typeof TripBriefSchema>;

export const TripProfileSchema = z.object({
  party: z.string().trim().min(1).max(80).default("solo"),
  travelerCount: z.number().int().min(1).max(20).optional(),
  budget: money.optional(),
  budgetBand: z.enum(["budget", "midrange", "premium", "luxury"]).optional(),
  pace: TripPaceSchema.default("balanced"),
  interests: z.array(nonEmpty("interest", 80)).max(12).default([]),
  constraints: z.record(z.unknown()).default({}),
  travelStyle: z.string().trim().max(120).optional()
});
export type TripProfile = z.infer<typeof TripProfileSchema>;

export const ProfilerOutputSchema = TripProfileSchema.extend({
  query: retrievalQuery,
  reasoning: z.string().trim().min(10).max(800).catch("Profile normalized from traveler brief and constraints.")
});
export type ProfilerOutput = z.infer<typeof ProfilerOutputSchema>;

export const DestinationAnchorSchema = z.object({
  name: nonEmpty("anchor name", 120),
  area: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
  why: z.string().trim().max(300).optional()
});
export type DestinationAnchor = z.infer<typeof DestinationAnchorSchema>;

export const DestinationIntelligenceSchema = z.object({
  destination: nonEmpty("destination", 120),
  seasonalityNotes: z.array(z.string().trim().max(240)).max(8).default([]),
  neighborhoods: z.array(nonEmpty("neighborhood", 120)).max(12).default([]),
  themes: z.array(nonEmpty("theme", 120)).max(10).default([]),
  anchors: z.array(DestinationAnchorSchema).max(16).default([]),
  warnings: z.array(z.string().trim().max(240)).max(8).default([])
});
export type DestinationIntelligence = z.infer<typeof DestinationIntelligenceSchema>;

export const StayRecommendationSchema = z.object({
  listingId: z.string().uuid(),
  title: nonEmpty("listing title", 160),
  area: z.string().trim().max(120).optional(),
  pricePerNight: money.optional(),
  currency: z.string().trim().max(12).optional(),
  maxGuests: z.number().int().min(1).optional(),
  matchScore: confidence,
  why: z.string().trim().min(8).max(500),
  source: z.enum(["pgvector", "aurora"]).default("pgvector"),
  hardFiltersPassed: z.boolean()
});
export type StayRecommendation = z.infer<typeof StayRecommendationSchema>;

export const DayArchitectureItemSchema = z.object({
  dayNumber: z.number().int().min(1).max(31),
  date: dateString.nullable().optional(),
  theme: nonEmpty("day theme", 120),
  area: z.string().trim().max(120).nullable().optional(),
  energy: z.enum(["low", "medium", "high"]).default("medium"),
  targetItemCount: z.number().int().min(1).max(6)
});
export type DayArchitectureItem = z.infer<typeof DayArchitectureItemSchema>;

export const DayArchitectureSchema = z.object({
  days: z.array(DayArchitectureItemSchema).min(1).max(14),
  reasoning: z.string().trim().max(1000).optional()
});
export type DayArchitecture = z.infer<typeof DayArchitectureSchema>;

export const TripPlanDaySchema = z.object({
  dayNumber: z.number().int().min(1).max(31),
  date: dateString.nullable().optional(),
  theme: z.string().trim().min(1).max(120).nullable().optional(),
  summary: z.string().trim().max(500).nullable().optional(),
  area: z.string().trim().max(120).nullable().optional()
});
export type TripPlanDay = z.infer<typeof TripPlanDaySchema>;

export const TripPlanItemSchema = z.object({
  dayNumber: z.number().int().min(1).max(31),
  timeLabel: z.string().trim().max(30).nullable().optional(),
  title: nonEmpty("item title", 140),
  description: z.string().trim().max(700).nullable().optional(),
  category: z.string().trim().max(80).nullable().optional(),
  source: z.string().trim().max(60).default("agent"),
  estCost: money.default(0),
  locked: z.boolean().default(false),
  stayListingId: z.string().uuid().nullable().optional(),
  placeName: z.string().trim().max(180).nullable().optional(),
  placeAddress: z.string().trim().max(260).nullable().optional(),
  placeUrl: z.string().trim().url().max(500).nullable().optional(),
  externalPlaceId: z.string().trim().max(180).nullable().optional(),
  placeRating: z.number().min(0).max(5).nullable().optional(),
  imageUrl: assetUrl.nullable().optional(),
  imageAttribution: z.record(z.unknown()).default({}),
  selectionRationale: z.string().trim().max(700).nullable().optional(),
  timingRationale: z.string().trim().max(500).nullable().optional(),
  costSource: z.string().trim().max(80).nullable().optional(),
  costRationale: z.string().trim().max(500).nullable().optional(),
  metadata: z.record(z.unknown()).default({})
});
export type TripPlanItem = z.infer<typeof TripPlanItemSchema>;

export const BudgetAllocationSchema = z.object({
  category: nonEmpty("budget category", 80),
  amount: money,
  reason: z.string().trim().max(240).optional()
});
export type BudgetAllocation = z.infer<typeof BudgetAllocationSchema>;

export const BudgetPlanSchema = z.object({
  currency: z.string().trim().max(12).default("USD"),
  totalEstimate: money,
  budgetFit: z.enum(["fit", "near_limit", "over_budget", "unknown"]),
  allocations: z.array(BudgetAllocationSchema).max(12).default([]),
  warnings: z.array(z.string().trim().max(240)).max(10).default([]),
  swapSuggestions: z.array(z.string().trim().max(240)).max(10).default([])
});
export type BudgetPlan = z.infer<typeof BudgetPlanSchema>;

export const VerifiedTripPlanSchema = z.object({
  summary: z.string().trim().min(10).max(1000),
  totalEstimate: money,
  planningContext: z.record(z.unknown()).default({}),
  days: z.array(TripPlanDaySchema).min(1).max(14),
  items: z.array(TripPlanItemSchema).min(1)
});
export type VerifiedTripPlan = z.infer<typeof VerifiedTripPlanSchema>;

export const TripPlanVerifierReportSchema = z.object({
  status: z.enum(["passed", "failed"]),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  repairs: z.array(z.string()),
  metrics: z.object({
    dayCount: z.number().int().min(0),
    itemCount: z.number().int().min(0),
    expectedDayCount: z.number().int().min(1).nullable(),
    estimatedCostTotal: money,
    maxItemsPerDay: z.number().int().min(1)
  })
});
export type TripPlanVerifierReport = z.infer<typeof TripPlanVerifierReportSchema>;
