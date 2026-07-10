import { z } from "zod";
import type { NewItineraryDay } from "@/lib/db/tables/trip/days";
import type { NewItineraryItem } from "@/lib/db/tables/trip/items";
import {
  BudgetPlanSchema,
  DayArchitectureSchema,
  DestinationIntelligenceSchema,
  ProfilerOutputSchema,
  StayRecommendationSchema,
  TripBriefSchema,
  TripPlanDaySchema,
  TripPlanItemSchema,
  VerifiedTripPlan,
  VerifiedTripPlanSchema
} from "./schemas";

/**
 * trip-planner composer - deterministic commit boundary.
 * Upstream agents judge and optimize; this file assembles Aurora-ready plan rows and context.
 */

export const TripPlannerComposerInputSchema = z.object({
  brief: TripBriefSchema,
  profile: ProfilerOutputSchema,
  destinationIntel: DestinationIntelligenceSchema,
  stayRecommendations: z.array(StayRecommendationSchema).default([]),
  dayArchitecture: DayArchitectureSchema,
  items: z.array(TripPlanItemSchema).min(1),
  logisticsWarnings: z.array(z.string().trim().max(240)).default([]),
  budgetPlan: BudgetPlanSchema,
  externalEnrichment: z.record(z.unknown()).default({})
});

export type TripPlannerComposerInput = z.infer<typeof TripPlannerComposerInputSchema>;

function clean(value: string | null | undefined, max: number) {
  return (value || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function sentence(parts: Array<string | undefined | null>) {
  return parts.map((part) => clean(part, 180)).filter(Boolean).join(" ");
}

function daySummary(input: TripPlannerComposerInput, day: TripPlannerComposerInput["dayArchitecture"]["days"][number]) {
  const area = clean(day.area || input.brief.destination, 120);
  const energy = day.energy === "high" ? "active" : day.energy === "low" ? "lighter" : "balanced";
  return clean(`${day.theme} anchored around ${area}, planned as a ${energy} day with ${day.targetItemCount} editable stops.`, 500);
}

function composeSummary(input: TripPlannerComposerInput) {
  const stay = input.stayRecommendations[0];
  const budget = input.budgetPlan.budgetFit.replace("_", " ");
  const stayLine = stay ? `Recommended stay: ${stay.title} in ${stay.area || input.brief.destination}.` : "No approved stay matched the current inventory filters yet.";
  return clean(
    sentence([
      `${input.brief.destination} plan for ${input.profile.party}.`,
      `Pace: ${input.profile.pace}; budget fit: ${budget}; projected total: ${input.budgetPlan.totalEstimate} ${input.budgetPlan.currency}.`,
      stayLine,
      "Days and activities are versioned, editable, and ready for traveler review."
    ]),
    1000
  );
}

function composeDays(input: TripPlannerComposerInput): NewItineraryDay[] {
  return input.dayArchitecture.days.map((day) =>
    TripPlanDaySchema.parse({
      dayNumber: day.dayNumber,
      date: day.date ?? null,
      theme: clean(day.theme, 120),
      summary: daySummary(input, day),
      area: clean(day.area || input.brief.destination, 120)
    })
  );
}

function composeItems(input: TripPlannerComposerInput): NewItineraryItem[] {
  const validDayNumbers = new Set(input.dayArchitecture.days.map((day) => day.dayNumber));
  const orderByDay = new Map<number, number>();

  return input.items
    .filter((item) => validDayNumbers.has(item.dayNumber))
    .map((item) => {
      const nextOrder = (orderByDay.get(item.dayNumber) || 0) + 1;
      orderByDay.set(item.dayNumber, nextOrder);

      return TripPlanItemSchema.parse({
        dayNumber: item.dayNumber,
        timeLabel: clean(item.timeLabel || `Stop ${nextOrder}`, 30),
        title: clean(item.title, 140),
        description: clean(item.description || "", 700),
        category: clean(item.category || "activity", 80),
        source: "composer",
        estCost: Math.max(0, Math.round(Number(item.estCost || 0))),
        locked: Boolean(item.locked),
        stayListingId: item.stayListingId ?? null,
        placeName: clean(item.placeName || "", 180) || null,
        placeAddress: clean(item.placeAddress || "", 260) || null,
        placeUrl: item.placeUrl ?? null,
        externalPlaceId: clean(item.externalPlaceId || "", 180) || null,
        placeRating: typeof item.placeRating === "number" ? item.placeRating : null,
        imageUrl: item.imageUrl ?? null,
        imageAttribution: item.imageAttribution ?? {},
        selectionRationale: clean(item.selectionRationale || "", 700) || null,
        timingRationale: clean(item.timingRationale || "", 500) || null,
        costSource: clean(item.costSource || "", 80) || null,
        costRationale: clean(item.costRationale || "", 500) || null,
        metadata: item.metadata ?? {}
      });
    });
}

function composePlanningContext(input: TripPlannerComposerInput) {
  return {
    brief: input.brief,
    profile: input.profile,
    destinationIntel: input.destinationIntel,
    stayRecommendations: input.stayRecommendations,
    dayArchitecture: input.dayArchitecture,
    budgetPlan: input.budgetPlan,
    logisticsWarnings: input.logisticsWarnings,
    externalEnrichment: input.externalEnrichment,
    dataBoundaries: {
      persistedBy: "deterministic-composer",
      staySource: "approved-wanderos-listings",
      budgetOwner: "budget-optimizer-deterministic-math",
      externalApiPolicy: "server-side enrichment only; missing keys degrade without fake live claims"
    }
  };
}

export function composeTripPlan(input: unknown): VerifiedTripPlan {
  const parsed = TripPlannerComposerInputSchema.parse(input);
  const days = composeDays(parsed);
  const items = composeItems(parsed);

  return VerifiedTripPlanSchema.parse({
    summary: composeSummary(parsed),
    totalEstimate: parsed.budgetPlan.totalEstimate,
    planningContext: composePlanningContext(parsed),
    days,
    items
  });
}
