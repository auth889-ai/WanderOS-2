import { VisionInput } from "./schema";

/** Builds the property-vision instruction. Strict: describe ONLY what is visible; analyze deeply. */
export function buildVisionPrompt(input: VisionInput): string {
  return `You are an expert property photo analyst for a ${input.category} listing. Study the attached photo
carefully and produce a DEEP analysis — but describe ONLY what is actually visible; never invent rooms,
features, or views that aren't in the image.

Assess every dimension:
- roomType + roomLabel: what space this is
- features: physical things visible (furniture, windows, fixtures)
- amenities: amenities visible (AC, TV, wifi, appliances, etc.)
- condition: poor | fair | good | excellent
- cleanliness: messy | acceptable | tidy | spotless
- lighting: dark | dim | natural | bright
- spaciousness: cramped | compact | comfortable | spacious
- style: the aesthetic (e.g. "modern minimalist", "rustic")
- qualityScore (0-100) of the SPACE, and photoQuality (low/medium/high) of the PHOTO itself
- highlights: standout selling points in this photo
- issues: any problems (clutter, damage, bad angle, poor light) — empty list if none
- improvementTips: concrete ways to improve this photo/space for marketing
- sellingAngle: the single best marketing angle for this photo
- confidence (0-1) and reasoning for your assessment`;
}
