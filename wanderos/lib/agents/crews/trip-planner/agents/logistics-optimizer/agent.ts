import { invokeStructured } from "@/lib/ai/structured";
import { TripPlanItem, TripPlanItemSchema } from "../../schemas";
import { buildLogisticsOptimizerPrompt } from "./prompt";
import {
  LogisticsOptimizerInput,
  LogisticsOptimizerInputSchema,
  LogisticsOptimizerResult,
  LogisticsOptimizerResultSchema
} from "./schema";

const TIME_ORDER = ["early morning", "morning", "late morning", "lunch", "midday", "afternoon", "dinner", "evening", "night"];

function clean(value: string | null | undefined, max: number) {
  return (value || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalize(value: string | null | undefined) {
  return clean(value, 160).toLowerCase();
}

function cost(value: unknown) {
  const amount = typeof value === "number" ? value : Number(value || 0);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.min(750, Math.round(amount));
}

function timeRank(label?: string | null) {
  const normalized = normalize(label);
  const rank = TIME_ORDER.findIndex((time) => normalized.includes(time));
  return rank >= 0 ? rank : 99;
}

function groupByDay(items: TripPlanItem[]) {
  const days = new Map<number, TripPlanItem[]>();
  for (const item of items) {
    days.set(item.dayNumber, [...(days.get(item.dayNumber) || []), item]);
  }
  return days;
}

function stableTimeLabels(originals: TripPlanItem[]) {
  return originals
    .map((item, index) => ({ label: item.timeLabel || `Stop ${index + 1}`, rank: timeRank(item.timeLabel), index }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((item) => item.label);
}

function normalizeItem(item: TripPlanItem | undefined, original: TripPlanItem, dayNumber: number, timeLabel: string): TripPlanItem {
  if (!item) {
    throw new Error(`logistics-optimizer missing item for day ${dayNumber} ${timeLabel}`);
  }
  const title = clean(item.title, 140);
  const description = clean(item.description || "", 700);
  const category = clean(item.category || "", 80);
  if (!title || !description || !category) {
    throw new Error(`logistics-optimizer returned incomplete item for day ${dayNumber} ${timeLabel}`);
  }
  return TripPlanItemSchema.parse({
    dayNumber,
    timeLabel,
    title,
    description,
    category,
    source: "logistics-optimizer",
    estCost: cost(item.estCost ?? original.estCost),
    locked: Boolean(original.locked),
    stayListingId: null
  });
}

function alignToOriginalShape(originalItems: TripPlanItem[], proposedItems: TripPlanItem[]): TripPlanItem[] {
  const originalByDay = groupByDay(originalItems);
  const proposedByDay = groupByDay(proposedItems);
  const result: TripPlanItem[] = [];

  for (const [dayNumber, originals] of [...originalByDay.entries()].sort(([a], [b]) => a - b)) {
    const labels = stableTimeLabels(originals);
    const proposed = proposedByDay.get(dayNumber) || [];
    if (proposed.length !== originals.length) {
      throw new Error(`logistics-optimizer returned ${proposed.length} items for day ${dayNumber}, expected ${originals.length}`);
    }

    for (let index = 0; index < originals.length; index += 1) {
      result.push(normalizeItem(proposed[index], originals[index], dayNumber, labels[index] || `Stop ${index + 1}`));
    }
  }

  return result;
}

function normalizeResult(input: LogisticsOptimizerInput, result: unknown): LogisticsOptimizerResult {
  const parsed = LogisticsOptimizerResultSchema.parse(result);
  return LogisticsOptimizerResultSchema.parse({
    items: alignToOriginalShape(input.items, parsed.items),
    warnings: [
      ...parsed.warnings,
      "Route order is a planning suggestion, not a live transit guarantee."
    ].slice(0, 8),
    reasoning: parsed.reasoning || "Logistics optimized while preserving day counts and activity candidates."
  });
}

/**
 * logistics-optimizer agent - improves flow without changing the itinerary contract.
 * The deterministic wrapper owns day counts, per-day item counts, source, time labels, and no stay ids.
 */
export async function optimizeLogistics(input: unknown): Promise<LogisticsOptimizerResult> {
  const parsed = LogisticsOptimizerInputSchema.parse(input);

  const generated = await invokeStructured(LogisticsOptimizerResultSchema, buildLogisticsOptimizerPrompt(parsed), {
    tier: "flash",
    retries: 1
  });
  return normalizeResult(parsed, generated);
}
