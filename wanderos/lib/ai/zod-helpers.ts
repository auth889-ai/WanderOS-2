import { z } from "zod";

/**
 * Robust Zod helpers for LLM output. Models occasionally return a string (or null) where an
 * array is expected, or an array of objects where strings are expected. These helpers coerce
 * those cases so the Quality-Gate doesn't fail on harmless formatting drift.
 *
 * They're cast to a clean output ZodType so z.infer yields string[] / number (zod's transform
 * input-variance otherwise leaks the raw union into inferred types).
 */

/** An array-of-strings that tolerates: a real array, an array of objects, a delimited string, or null. */
export const flexStringArray = z
  .union([z.array(z.any()), z.string(), z.null(), z.undefined()])
  .transform((v): string[] => {
    if (Array.isArray(v)) {
      return v
        .map((x) => (typeof x === "string" ? x : String(x?.name ?? x?.title ?? x?.label ?? JSON.stringify(x))))
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (typeof v === "string") {
      return v.trim()
        ? v
            .split(/[,;\n]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    }
    return [];
  }) as unknown as z.ZodType<string[]>;

/**
 * An array of objects that tolerates the model using ALIAS keys or the wrong nesting for a field
 * (e.g. returning {room:'Bedroom 1'} or {title:'Bedroom 1'} when the schema wants {name:'Bedroom 1'}).
 * Pass a spec mapping each canonical key to its accepted aliases + kind ('string' | 'stringArray').
 * For each item it picks the first present alias, coerces it, and drops items that are empty objects.
 * This keeps rich nested schemas (room breakdowns, bed configs, amenity groups) robust to harmless drift.
 */
type FlexField = { aliases: string[]; kind: "string" | "stringArray"; fallback?: string };
type FlexOut<S extends Record<string, FlexField>> = {
  [K in keyof S]: S[K]["kind"] extends "stringArray" ? string[] : string;
};
export function flexObjectArray<const S extends Record<string, FlexField>>(fields: S): z.ZodType<FlexOut<S>[]> {
  const keys = Object.keys(fields) as (keyof S)[];
  const pick = (item: Record<string, unknown>, spec: FlexField, canonical: string): unknown => {
    for (const a of [canonical, ...spec.aliases]) {
      const v = item[a];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return undefined;
  };
  return z
    .union([z.array(z.any()), z.null(), z.undefined()])
    .transform((arr): FlexOut<S>[] => {
      if (!Array.isArray(arr)) return [];
      return arr
        .map((raw) => {
          const item = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
          const out: Record<string, unknown> = {};
          for (const k of keys) {
            const spec = fields[k];
            const val = pick(item, spec, k as string);
            if (spec.kind === "stringArray") {
              out[k as string] = Array.isArray(val) ? val.map((x) => String(x).trim()).filter(Boolean) : typeof val === "string" && val.trim() ? [val.trim()] : [];
            } else {
              out[k as string] = val === undefined ? spec.fallback ?? "" : Array.isArray(val) ? val.join(", ") : String(val).trim();
            }
          }
          return out as FlexOut<S>;
        })
        .filter((o) => keys.some((k) => (Array.isArray(o[k]) ? (o[k] as unknown[]).length : o[k])));
    }) as unknown as z.ZodType<FlexOut<S>[]>;
}

/**
 * A case-insensitive enum: tolerates the model returning 'Bedroom' / ' BEDROOM ' for a 'bedroom'
 * enum (lower-cases + trims before validating). Falls back to the first allowed value only if the
 * model returns something not in the set — but the lower-cased match covers the common drift.
 */
export function lowerEnum<T extends readonly [string, ...string[]]>(values: T) {
  const set = new Set<string>(values);
  return z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v): T[number] => {
      const norm = typeof v === "string" ? v.trim().toLowerCase() : "";
      return (set.has(norm) ? norm : values[0]) as T[number];
    }) as unknown as z.ZodType<T[number]>;
}

/** A 0-1 confidence that tolerates the model returning 0-100, a string, or null. */
export const confidence01 = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((v): number => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0.5;
    const norm = n > 1 ? n / 100 : n;
    return Math.max(0, Math.min(1, norm));
  }) as unknown as z.ZodType<number>;
