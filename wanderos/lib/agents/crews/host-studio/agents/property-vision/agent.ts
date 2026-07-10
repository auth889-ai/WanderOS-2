import { invokeStructuredVision } from "@/lib/ai/structured";
import { PhotoAnalysisSchema, PhotoAnalysis, VisionInput } from "./schema";
import { buildVisionPrompt } from "./prompt";

/**
 * property-vision agent — analyzes ONE photo with Gemini vision (multimodal).
 *
 * Grounding IS the real photo: the agent reasons only over the actual image, never invents.
 * Runs once per photo (the graph maps it over all photos in parallel), then the aggregator
 * merges the per-photo results. "flash" tier (vision-capable, fast).
 */
export async function propertyVision(input: VisionInput): Promise<PhotoAnalysis> {
  return invokeStructuredVision(PhotoAnalysisSchema, buildVisionPrompt(input), [input.imageUrl], { tier: "flash" });
}
