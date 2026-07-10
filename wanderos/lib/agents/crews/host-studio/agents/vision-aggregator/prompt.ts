import { AggregatorInput } from "./schema";

/** Builds the vision-aggregator instruction: synthesize one profile from the per-photo analyses. */
export function buildAggregatorPrompt(input: AggregatorInput): string {
  const perPhoto = input.analyses
    .map((a, i) => `Photo ${i + 1}: ${JSON.stringify({
      roomType: a.roomType,
      roomLabel: a.roomLabel,
      features: a.features,
      amenities: a.amenities,
      condition: a.condition,
      cleanliness: a.cleanliness,
      qualityScore: a.qualityScore,
      highlights: a.highlights,
      issues: a.issues
    })}`)
    .join("\n");

  return `You are a property profile synthesizer. You are given per-photo analyses of a ${input.category}.
Merge them into ONE coherent property profile. Reason across the photos — do not just copy one.

HOST NOTES: ${input.notes}

PER-PHOTO ANALYSES (${input.analyses.length} photos):
${perPhoto}

SYNTHESIZE
- roomsCovered: which room types have a photo
- missingRooms: expected rooms for a ${input.category} with NO photo (coverage gaps)
- allFeatures / allAmenities: de-duplicated union across photos
- overallCondition + overallQuality (0-100): weight by photo quality; one bad photo shouldn't tank a strong property
- photoCoverage: sparse | adequate | comprehensive
- aestheticStyle: the consistent style across photos
- contradictions: conflicting signals between photos (empty if none)
- topHighlights: the strongest selling points across the whole property
- improvementPriorities: the most important presentation fixes
- confidence (0-1) and reasoning for how you synthesized the profile`;
}
