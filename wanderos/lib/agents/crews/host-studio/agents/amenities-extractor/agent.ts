import { invokeStructured } from "@/lib/ai/structured";
import { AmenitiesSchema, AmenitiesFacts, AmenitiesInput } from "./schema";
import { buildAmenitiesPrompt } from "./prompt";

/**
 * amenities-extractor agent — extracts the definitive structured listing facts.
 *
 * Uses the "extract" tier (Groq — ultra-fast, low-temperature) because this is deterministic
 * fact extraction, not creative work: speed + consistency matter more than flair. Honest — only
 * asserts what the profile + notes support, and flags anything it had to assume.
 */
export async function amenitiesExtractor(input: AmenitiesInput): Promise<AmenitiesFacts> {
  return invokeStructured(AmenitiesSchema, buildAmenitiesPrompt(input), { tier: "extract" });
}
