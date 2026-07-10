import { z } from "zod";
import { flexStringArray, confidence01, lowerEnum } from "@/lib/ai/zod-helpers";
import { PhotoAnalysis } from "../property-vision/schema";

/**
 * vision-aggregator — input + output contracts.
 * Merges all per-photo analyses (from property-vision) into ONE property profile. Pure synthesis:
 * it cross-references the photos, finds coverage gaps, flags contradictions, weights by quality.
 */
export type AggregatorInput = {
  category: string;
  notes: string;
  analyses: PhotoAnalysis[]; // one per photo, from property-vision
};

export const PropertyProfileSchema = z.object({
  roomsCovered: flexStringArray.describe("room types that have at least one photo"),
  missingRooms: flexStringArray.describe("expected room types for this category with NO photo (coverage gaps)"),
  allFeatures: flexStringArray.describe("de-duplicated union of features across all photos"),
  allAmenities: flexStringArray.describe("de-duplicated union of amenities across all photos"),
  overallCondition: lowerEnum(["poor", "fair", "good", "excellent"]).describe("the property's overall condition"),
  overallQuality: z.number().min(0).max(100).describe("weighted overall quality, 0-100"),
  photoCoverage: lowerEnum(["sparse", "adequate", "comprehensive"]).describe("how well the photos cover the property"),
  aestheticStyle: z.string().describe("the consistent aesthetic across the photos"),
  contradictions: flexStringArray.describe("conflicting signals across photos (e.g. one tidy, one messy) — empty if none"),
  topHighlights: flexStringArray.describe("the strongest selling points across the whole property"),
  improvementPriorities: flexStringArray.describe("the most important presentation/photo improvements to make"),
  confidence: confidence01.describe("confidence in this profile, 0-1"),
  reasoning: z.string().describe("how the profile was synthesized from the individual photos")
});

export type PropertyProfile = z.infer<typeof PropertyProfileSchema>;
