import { invokeStructuredVision } from "@/lib/ai/structured";
import { buildShotVisionPrompt } from "./prompt";
import { ShotVisionInputSchema, ShotVisionResult, ShotVisionResultSchema } from "./schema";

export async function analyzePostShots(input: unknown): Promise<ShotVisionResult> {
  const parsed = ShotVisionInputSchema.parse(input);
  const photos = parsed.media.filter((item) => item.mediaKind === "photo");
  const videos = parsed.media.filter((item) => item.mediaKind === "video" || item.mediaKind === "reel");

  if (!photos.length) {
    return {
      visualSummary: videos.length
        ? "The post includes traveler video media. Video frame analysis is not enabled in this compose pass."
        : "No uploaded photo was provided, so the post must be composed from traveler text and linked trip/stay context only.",
      vibe: parsed.destination ? `${parsed.destination} traveler update` : "traveler update",
      bestShots: [],
      placeClues: [parsed.destination, parsed.location].filter(Boolean) as string[],
      honestyNotes: ["Do not claim visual details that were not supplied by the traveler."]
    };
  }

  const result = await invokeStructuredVision(
    ShotVisionResultSchema,
    buildShotVisionPrompt(parsed),
    photos.slice(0, 6).map((item) => item.mediaUrl),
    { tier: "flash" }
  );
  const normalized = ShotVisionResultSchema.parse(result);
  return {
    ...normalized,
    bestShots: normalized.bestShots.map((shot, index) => {
      const exact = photos.find((item) => item.mediaUrl === shot.mediaUrl);
      return {
        ...shot,
        mediaUrl: exact?.mediaUrl ?? photos[index]?.mediaUrl ?? photos[0].mediaUrl
      };
    })
  };
}
