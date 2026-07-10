import { z } from "zod";
import { lowerEnum } from "@/lib/ai/zod-helpers";

/**
 * property-vision — input + output contracts.
 * Analyzes ONE photo (runs per-photo / "map" in the graph). The image is the grounding.
 * The schema is intentionally RICH so the agent must produce deep, comprehensive analysis.
 * Enums use lowerEnum() so harmless case drift ('Bedroom' -> 'bedroom') self-corrects instead of failing.
 */
export type VisionInput = {
  imageUrl: string; // http(s) url or data URI of one property photo
  category: string; // apartment / villa / hotel / ...
};

export const PhotoAnalysisSchema = z.object({
  roomType: lowerEnum([
    "bedroom",
    "living-room",
    "kitchen",
    "bathroom",
    "dining",
    "balcony",
    "exterior",
    "pool",
    "garden",
    "hallway",
    "workspace",
    "view",
    "other"
  ]).describe("the kind of space shown"),
  roomLabel: z.string().describe("specific label, e.g. 'master bedroom', 'rooftop balcony', 'street view'"),
  features: z.array(z.string()).describe("physical features visible (e.g. 'king bed', 'floor-to-ceiling windows')"),
  amenities: z.array(z.string()).describe("amenities visible (e.g. 'AC unit', 'smart TV', 'wifi router', 'oven')"),
  condition: lowerEnum(["poor", "fair", "good", "excellent"]).describe("condition of the space"),
  cleanliness: lowerEnum(["messy", "acceptable", "tidy", "spotless"]).describe("how clean/staged it looks"),
  lighting: lowerEnum(["dark", "dim", "natural", "bright"]).describe("the lighting in the photo"),
  spaciousness: lowerEnum(["cramped", "compact", "comfortable", "spacious"]).describe("perceived size of the space"),
  style: z.string().describe("aesthetic style, e.g. 'modern minimalist', 'rustic', 'traditional'"),
  qualityScore: z.number().min(0).max(100).describe("overall quality of the SPACE, 0-100"),
  photoQuality: lowerEnum(["low", "medium", "high"]).describe("quality of the PHOTO itself (framing, sharpness, light)"),
  highlights: z.array(z.string()).describe("standout selling points a buyer would notice in this photo"),
  issues: z.array(z.string()).describe("problems detected (clutter, damage, bad angle, poor light) — empty if none"),
  improvementTips: z.array(z.string()).describe("concrete ways to improve this photo/space for the listing"),
  sellingAngle: z.string().describe("the single best marketing angle for this photo"),
  confidence: z.number().min(0).max(1).describe("how confident this analysis is, 0-1"),
  reasoning: z.string().describe("brief reasoning behind the condition/quality assessment")
});

export type PhotoAnalysis = z.infer<typeof PhotoAnalysisSchema>;
