import { z } from "zod";
import {
  TripPace,
  TripPaceSchema,
  TripPlanDaySchema,
  TripPlanItemSchema,
  TripPlanVerifierReport,
  TripPlanVerifierReportSchema
} from "./schemas";
import type { NewItineraryDay } from "@/lib/db/tables/trip/days";
import type { NewItineraryItem } from "@/lib/db/tables/trip/items";

/**
 * trip-planner verifier - deterministic gate before any plan is persisted.
 * LLMs can suggest itinerary content; this file enforces structural, budget, and inventory rules.
 */

const VerificationInputSchema = z.object({
  destination: z.string().trim().min(1),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
  pace: TripPaceSchema.default("balanced"),
  budget: z.number().min(0).optional(),
  totalEstimate: z.number().min(0).optional(),
  days: z.array(TripPlanDaySchema).min(1).max(14),
  items: z.array(TripPlanItemSchema).min(1),
  allowedStayListingIds: z.array(z.string().uuid()).optional()
});
type ParsedVerificationInput = z.infer<typeof VerificationInputSchema>;

export type VerifyTripPlanInput = {
  destination: string;
  startDate?: string;
  endDate?: string;
  pace?: TripPace | string;
  budget?: number;
  totalEstimate?: number;
  days: NewItineraryDay[];
  items: NewItineraryItem[];
  allowedStayListingIds?: string[];
};

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function expectedDayCount(startDate?: string, endDate?: string): number | null {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end || end < start) return null;
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

function maxItemsForPace(pace: TripPace): number {
  if (pace === "relaxed") return 3;
  if (pace === "packed") return 6;
  return 4;
}

function safePace(value?: string): TripPace {
  const parsed = TripPaceSchema.safeParse(value);
  return parsed.success ? parsed.data : "balanced";
}

function hasHtml(value?: string | null): boolean {
  return !!value && /<\/?[a-z][\s\S]*>/i.test(value);
}

function normalizeForSchema(input: VerifyTripPlanInput): unknown {
  return {
    destination: input.destination,
    startDate: input.startDate || undefined,
    endDate: input.endDate || undefined,
    pace: input.pace || "balanced",
    budget: input.budget,
    totalEstimate: input.totalEstimate,
    allowedStayListingIds: input.allowedStayListingIds,
    days: input.days,
    items: input.items
  };
}

export function verifyTripPlan(input: VerifyTripPlanInput): TripPlanVerifierReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const repairs: string[] = [];
  const expected = expectedDayCount(input.startDate, input.endDate);

  const parsed = VerificationInputSchema.safeParse(normalizeForSchema(input));
  if (!parsed.success) {
    errors.push(...parsed.error.issues.map((i) => `${i.path.join(".") || "plan"}: ${i.message}`));
    return TripPlanVerifierReportSchema.parse({
      status: "failed",
      errors,
      warnings,
      repairs,
      metrics: {
        dayCount: input.days.length,
        itemCount: input.items.length,
        expectedDayCount: expected,
        estimatedCostTotal: input.items.reduce((sum, item) => sum + (item.estCost ?? 0), 0),
        maxItemsPerDay: maxItemsForPace(safePace(input.pace))
      }
    });
  }

  const plan: ParsedVerificationInput = parsed.data;
  const maxItemsPerDay = maxItemsForPace(plan.pace);
  const dayNumbers = new Set<number>();
  const itemCounts = new Map<number, number>();
  const titleCountsByDay = new Map<string, number>();
  const allowedStayIds = new Set(plan.allowedStayListingIds ?? []);
  const start = parseDate(plan.startDate);

  if (expected && plan.days.length !== expected) {
    errors.push(`day count ${plan.days.length} does not match requested trip length ${expected}`);
  }

  for (const day of plan.days) {
    if (dayNumbers.has(day.dayNumber)) errors.push(`duplicate day number ${day.dayNumber}`);
    dayNumbers.add(day.dayNumber);

    if (day.dayNumber !== dayNumbers.size) {
      warnings.push("days should be sequential starting at 1");
    }

    if (start) {
      const expectedDate = formatDate(addDays(start, day.dayNumber - 1));
      if (day.date !== expectedDate) {
        errors.push(`day ${day.dayNumber} date must be ${expectedDate}`);
      }
    }

    if (hasHtml(day.theme) || hasHtml(day.summary) || hasHtml(day.area)) {
      errors.push(`day ${day.dayNumber} contains HTML-like text`);
    }
  }

  for (const item of plan.items) {
    if (!dayNumbers.has(item.dayNumber)) {
      errors.push(`item "${item.title}" points to missing day ${item.dayNumber}`);
    }

    itemCounts.set(item.dayNumber, (itemCounts.get(item.dayNumber) ?? 0) + 1);

    const titleKey = `${item.dayNumber}:${item.title.trim().toLowerCase()}`;
    titleCountsByDay.set(titleKey, (titleCountsByDay.get(titleKey) ?? 0) + 1);

    if (
      hasHtml(item.title) ||
      hasHtml(item.description) ||
      hasHtml(item.category) ||
      hasHtml(item.placeName) ||
      hasHtml(item.placeAddress) ||
      hasHtml(item.selectionRationale) ||
      hasHtml(item.timingRationale) ||
      hasHtml(item.costRationale)
    ) {
      errors.push(`item "${item.title}" contains HTML-like text`);
    }

    if (item.stayListingId && allowedStayIds.size > 0 && !allowedStayIds.has(item.stayListingId)) {
      errors.push(`item "${item.title}" references a stay listing that was not approved by stay-matcher`);
    }
  }

  for (const dayNumber of dayNumbers) {
    const count = itemCounts.get(dayNumber) ?? 0;
    if (count === 0) errors.push(`day ${dayNumber} has no itinerary items`);
    if (count > maxItemsPerDay) errors.push(`day ${dayNumber} has ${count} items, max ${maxItemsPerDay} for ${plan.pace} pace`);
  }

  for (const [key, count] of titleCountsByDay) {
    if (count <= 1) continue;
    const [dayNumber, title] = key.split(":");
    if (count > 2) errors.push(`duplicate item spam on day ${dayNumber}: "${title}" appears ${count} times`);
    else warnings.push(`duplicate item title appears twice on day ${dayNumber}: "${title}"`);
  }

  const estimatedCostTotal = plan.items.reduce((sum, item) => sum + item.estCost, 0);
  if (typeof plan.totalEstimate === "number") {
    const delta = Math.abs(plan.totalEstimate - estimatedCostTotal);
    if (delta > Math.max(5, estimatedCostTotal * 0.1)) {
      warnings.push(`total estimate ${plan.totalEstimate} differs from item total ${estimatedCostTotal}`);
    }
  }

  if (typeof plan.budget === "number" && plan.budget > 0 && estimatedCostTotal > plan.budget * 1.15) {
    warnings.push(`estimated activities ${estimatedCostTotal} exceed budget guardrail ${Math.round(plan.budget * 1.15)}`);
  }

  return TripPlanVerifierReportSchema.parse({
    status: errors.length ? "failed" : "passed",
    errors,
    warnings,
    repairs,
    metrics: {
      dayCount: plan.days.length,
      itemCount: plan.items.length,
      expectedDayCount: expected,
      estimatedCostTotal,
      maxItemsPerDay
    }
  });
}

export function assertTripPlanVerified(input: VerifyTripPlanInput): TripPlanVerifierReport {
  const report = verifyTripPlan(input);
  if (report.status === "failed") {
    throw new Error(`Trip plan failed verification: ${report.errors.join("; ")}`);
  }
  return report;
}
