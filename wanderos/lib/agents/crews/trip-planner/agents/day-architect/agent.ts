import { invokeStructured } from "@/lib/ai/structured";
import { DayArchitectureSchema, TripPace } from "../../schemas";
import { buildDayArchitectPrompt, DaySlot } from "./prompt";
import {
  DayArchitectInput,
  DayArchitectInputSchema,
  DayArchitectResult,
  DayArchitectResultSchema
} from "./schema";

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

function inclusiveDayCount(input: DayArchitectInput) {
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

function buildSlots(input: DayArchitectInput): DaySlot[] {
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

function normalizeResult(result: unknown, slots: DaySlot[]): DayArchitectResult {
  const parsedResult = DayArchitectureSchema.parse(result);
  const byDay = new Map(parsedResult.days.map((day) => [day.dayNumber, day]));
  const days = slots.map((slot) => {
    const generated = byDay.get(slot.dayNumber);
    if (!generated) {
      throw new Error(`day-architect missing required day ${slot.dayNumber}`);
    }
    if ((generated.date ?? null) !== slot.date) {
      throw new Error(`day-architect date mismatch for day ${slot.dayNumber}`);
    }
    return {
      dayNumber: slot.dayNumber,
      date: slot.date,
      theme: generated.theme.trim(),
      area: generated.area?.trim() || null,
      energy: generated.energy,
      targetItemCount: clamp(generated.targetItemCount, slot.minItems, slot.maxItems)
    };
  });

  return DayArchitectureSchema.parse({
    days,
    reasoning: parsedResult.reasoning || "Day architecture normalized against deterministic date and pace constraints."
  });
}

/**
 * day-architect agent - creates the day skeleton after profile, destination intel, and stay matching.
 * Deterministic code owns day count/date/pace bounds; the model chooses useful themes and area anchors.
 */
export async function architectDays(input: unknown): Promise<DayArchitectResult> {
  const parsed = DayArchitectInputSchema.parse(input);
  const slots = buildSlots(parsed);

  const generated = await invokeStructured(DayArchitectResultSchema, buildDayArchitectPrompt(parsed, slots), {
    tier: "flash",
    retries: 1
  });
  return normalizeResult(generated, slots);
}
