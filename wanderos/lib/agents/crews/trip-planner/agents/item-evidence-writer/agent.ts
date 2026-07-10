import { invokeStructured } from "@/lib/ai/structured";
import { TripPlanItem, TripPlanItemSchema } from "../../schemas";
import { buildItemEvidenceWriterPrompt } from "./prompt";
import {
  ItemEvidenceWriterInput,
  ItemEvidenceWriterInputSchema,
  ItemEvidenceWriterResultSchema
} from "./schema";

function clean(value: string | null | undefined, max: number) {
  return (value || "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

function mergeText(item: TripPlanItem, text: ReturnType<typeof ItemEvidenceWriterResultSchema.parse>["items"][number]) {
  return TripPlanItemSchema.parse({
    ...item,
    description: clean(text.description, 700),
    selectionRationale: clean(text.selectionRationale, 700),
    timingRationale: clean(text.timingRationale, 500),
    costRationale: clean(text.costRationale, 500),
    metadata: {
      ...(item.metadata ?? {}),
      travelerTip: clean(text.travelerTip, 240),
      verificationNote: clean(text.verificationNote, 240),
      evidenceWriterGeneratedAt: new Date().toISOString()
    }
  });
}

function alignResult(input: ItemEvidenceWriterInput, result: unknown) {
  const parsed = ItemEvidenceWriterResultSchema.parse(result);
  if (parsed.items.length !== input.items.length) {
    throw new Error(`item-evidence-writer returned ${parsed.items.length} items, expected ${input.items.length}`);
  }

  return input.items.map((item, index) => {
    const text = parsed.items[index];
    if (text.dayNumber !== item.dayNumber) {
      throw new Error(`item-evidence-writer day mismatch at index ${index}: ${text.dayNumber} !== ${item.dayNumber}`);
    }
    return mergeText(item, text);
  });
}

export async function writeItemEvidence(input: unknown): Promise<{ items: TripPlanItem[] }> {
  const parsed = ItemEvidenceWriterInputSchema.parse(input);
  const result = await invokeStructured(ItemEvidenceWriterResultSchema, buildItemEvidenceWriterPrompt(parsed), {
    tier: "pro",
    retries: 1
  });
  return { items: alignResult(parsed, result) };
}
