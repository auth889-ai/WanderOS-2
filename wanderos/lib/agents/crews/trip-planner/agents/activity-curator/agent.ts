import { invokeStructured } from "@/lib/ai/structured";
import { DayArchitecture, DayArchitectureSchema, TripPace, TripPlanItem, TripPlanItemSchema } from "../../schemas";
import {
  buildActivityCuratorPrompt,
  buildActivitySlots,
  buildItineraryDesignerPrompt,
  ActivitySlot,
  ItineraryDaySlot
} from "./prompt";
import {
  ActivityCuratorInputSchema,
  ActivityCuratorResult,
  ActivityCuratorResultSchema,
  ItineraryDesignerInput,
  ItineraryDesignerInputSchema,
  ItineraryDesignerResult,
  ItineraryDesignerResultSchema
} from "./schema";

function clean(value: string | null | undefined, max: number) {
  return (value || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function clampCost(value: unknown) {
  const amount = typeof value === "number" ? value : Number(value || 0);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.min(750, Math.round(amount));
}

function parseDate(value?: string) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function inclusiveDayCount(input: ItineraryDesignerInput) {
  const start = parseDate(input.brief.startDate);
  const end = parseDate(input.brief.endDate);
  if (!start || !end || end.getTime() < start.getTime()) return 3;
  const diff = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  return Math.max(1, Math.min(14, diff));
}

function itemRangeForPace(pace: TripPace): { min: number; max: number } {
  if (pace === "relaxed") return { min: 2, max: 3 };
  if (pace === "packed") return { min: 4, max: 6 };
  return { min: 3, max: 4 };
}

function defaultEnergy(dayNumber: number, dayCount: number, pace: TripPace): "low" | "medium" | "high" {
  if (dayCount === 1) return pace === "packed" ? "medium" : "low";
  if (dayNumber === 1 || dayNumber === dayCount) return pace === "packed" ? "medium" : "low";
  if (pace === "relaxed") return "medium";
  if (pace === "packed") return "high";
  return dayNumber % 2 === 0 ? "high" : "medium";
}

function buildItineraryDaySlots(input: ItineraryDesignerInput): ItineraryDaySlot[] {
  const count = inclusiveDayCount(input);
  const start = parseDate(input.brief.startDate);
  const range = itemRangeForPace(input.profile.pace);
  return Array.from({ length: count }, (_, index) => {
    const dayNumber = index + 1;
    return {
      dayNumber,
      date: start ? isoDate(addDays(start, index)) : null,
      defaultEnergy: defaultEnergy(dayNumber, count, input.profile.pace),
      minItems: range.min,
      maxItems: range.max
    };
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeGeneratedItem(item: TripPlanItem | undefined, slot: ActivitySlot): TripPlanItem {
  if (!item) {
    throw new Error(`activity-curator missing item for day ${slot.dayNumber} ${slot.timeLabel}`);
  }

  const title = clean(item.title, 140);
  const description = clean(item.description || "", 700);
  const category = clean(item.category || "", 80);
  if (!title || !description || !category) {
    throw new Error(`activity-curator returned incomplete item for day ${slot.dayNumber} ${slot.timeLabel}`);
  }

  return TripPlanItemSchema.parse({
    dayNumber: slot.dayNumber,
    timeLabel: slot.timeLabel,
    title,
    description,
    category,
    source: "activity-curator",
    estCost: clampCost(item.estCost),
    locked: false,
    stayListingId: null
  });
}

function normalizeResult(result: unknown, slots: ActivitySlot[]): ActivityCuratorResult {
  const parsed = ActivityCuratorResultSchema.parse(result);
  if (parsed.items.length !== slots.length) {
    throw new Error(`activity-curator returned ${parsed.items.length} items, expected ${slots.length}`);
  }
  const byDay = new Map<number, TripPlanItem[]>();

  for (const item of parsed.items) {
    byDay.set(item.dayNumber, [...(byDay.get(item.dayNumber) || []), item]);
  }

  const usedByDay = new Map<number, number>();
  const items = slots.map((slot, index) => {
    const used = usedByDay.get(slot.dayNumber) || 0;
    const candidate = byDay.get(slot.dayNumber)?.[used];
    usedByDay.set(slot.dayNumber, used + 1);
    return normalizeGeneratedItem(candidate, slot);
  });

  return ActivityCuratorResultSchema.parse({
    items,
    reasoning: parsed.reasoning || "Activity candidates normalized against day architecture slots."
  });
}

function normalizeDesignedDays(result: unknown, slots: ItineraryDaySlot[]): DayArchitecture {
  const parsed = ItineraryDesignerResultSchema.parse(result);
  const byDay = new Map(parsed.dayArchitecture.days.map((day) => [day.dayNumber, day]));
  const days = slots.map((slot) => {
    const generated = byDay.get(slot.dayNumber);
    if (!generated) throw new Error(`itinerary-designer missing required day ${slot.dayNumber}`);
    if ((generated.date ?? null) !== slot.date) throw new Error(`itinerary-designer date mismatch for day ${slot.dayNumber}`);
    return {
      dayNumber: slot.dayNumber,
      date: slot.date,
      theme: clean(generated.theme, 120),
      area: clean(generated.area || "", 120) || null,
      energy: generated.energy || slot.defaultEnergy,
      targetItemCount: clamp(generated.targetItemCount, slot.minItems, slot.maxItems)
    };
  });

  return DayArchitectureSchema.parse({
    days,
    reasoning: parsed.dayArchitecture.reasoning || parsed.reasoning || "Itinerary designed from traveler profile, destination context, and pace bounds."
  });
}

function normalizeDesignedResult(result: unknown, slots: ItineraryDaySlot[]): ItineraryDesignerResult {
  const parsed = ItineraryDesignerResultSchema.parse(result);
  const dayArchitecture = normalizeDesignedDays(parsed, slots);
  const activitySlots = buildActivitySlots(dayArchitecture.days);
  const curated = normalizeResult({ items: parsed.items, reasoning: parsed.reasoning }, activitySlots);

  return ItineraryDesignerResultSchema.parse({
    dayArchitecture,
    items: curated.items.map((item) => TripPlanItemSchema.parse({ ...item, source: "itinerary-designer" })),
    warnings: [
      ...parsed.warnings,
      "Route order is a planning suggestion, not a live transit guarantee."
    ].slice(0, 8),
    reasoning: parsed.reasoning || "Combined day architecture, activity selection, and practical flow in one premium step."
  });
}

/**
 * activity-curator agent - creates editable activity candidates for each day slot.
 * The deterministic wrapper owns item count, dayNumber/timeLabel, source, costs, and no stay IDs.
 */
export async function curateActivities(input: unknown): Promise<ActivityCuratorResult> {
  const parsed = ActivityCuratorInputSchema.parse(input);
  const slots = buildActivitySlots(parsed.dayArchitecture.days);

  const generated = await invokeStructured(ActivityCuratorResultSchema, buildActivityCuratorPrompt(parsed, slots), {
    tier: "pro",
    retries: 1
  });
  return normalizeResult(generated, slots);
}

/**
 * itinerary-designer agent - premium faster path.
 * One strong call replaces day-architect + activity-curator + logistics-optimizer, while deterministic
 * code still owns date math, pace bounds, item counts, source labels, and no live claims.
 */
export async function designItinerary(input: unknown): Promise<ItineraryDesignerResult> {
  const parsed = ItineraryDesignerInputSchema.parse(input);
  const slots = buildItineraryDaySlots(parsed);

  const generated = await invokeStructured(ItineraryDesignerResultSchema, buildItineraryDesignerPrompt(parsed, slots), {
    tier: "pro",
    retries: 1
  });
  return normalizeDesignedResult(generated, slots);
}
