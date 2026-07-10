import { runShotVision } from "./agents/shot-vision/agent";
import { runModeDirector } from "./agents/mode-director/agent";
import { runNarrationWriter } from "./agents/narration-writer/agent";
import { runCaptionWriter } from "./agents/caption-writer/agent";
import type { VideoMode } from "./types";

/**
 * The video CREW — a real multi-agent pipeline (replaces the single storyboard call):
 *   shot-vision (perceive) → mode-director (order/pacing/music) → narration-writer (voice script) → caption-writer
 * Each is a specialized LLM agent on the right tier. Produces the storyboard the orchestrator renders.
 */
export interface CrewShot {
  photoIndex: number;
  room: string;
  motionPrompt: string;
  caption: string;
  narration: string;
}
export interface VideoCrewResult {
  title: string;
  musicMood: string;
  shots: CrewShot[];
}

const MODE_MOTION: Record<VideoMode, string> = {
  walkthrough: "smooth interior camera motion",
  day_to_dusk: "warm cinematic motion",
  staging_reveal: "gentle revealing motion",
  drone: "wide pull-back motion",
  social_reel: "punchy dynamic motion"
};

export async function runVideoCrew(input: {
  photoUrls: string[];
  mode: VideoMode;
  narrate: boolean;
  hostNarration?: string;
  listingTitle?: string;
  city?: string;
  onAgent?: (name: string) => void;
}): Promise<VideoCrewResult> {
  const onAgent = input.onAgent ?? (() => {});

  // 1) perceive every photo
  onAgent("shot-vision");
  const perceived = await runShotVision(input.photoUrls);
  const byIndex = new Map(perceived.shots.map((s) => [s.photoIndex, s]));

  // 2) direct: order + pacing + music (drops duplicate rooms)
  onAgent("mode-director");
  const plan = await runModeDirector({ perceived, mode: input.mode });
  let order = plan.orderedPhotoIndexes.filter((i) => byIndex.has(i));
  if (!order.length) order = perceived.shots.map((s) => s.photoIndex);
  const orderedShots = order.map((i) => byIndex.get(i)!);

  // 3) narration (Type 2 only)
  let title = input.listingTitle ?? "Your Stay";
  const narrationByIdx = new Map<number, string>();
  if (input.narrate) {
    onAgent("narration-writer");
    const script = await runNarrationWriter({
      orderedShots: orderedShots.map((s) => ({ photoIndex: s.photoIndex, room: s.room, features: s.features })),
      mode: input.mode,
      styleNote: plan.styleNote,
      hostNarration: input.hostNarration,
      listingTitle: input.listingTitle,
      city: input.city
    });
    title = script.title || title;
    for (const l of script.lines) narrationByIdx.set(l.photoIndex, l.narration);
  }

  // 4) captions
  onAgent("caption-writer");
  const caps = await runCaptionWriter({ orderedShots: orderedShots.map((s) => ({ photoIndex: s.photoIndex, room: s.room })) });
  const capByIdx = new Map(caps.captions.map((c) => [c.photoIndex, c.caption]));

  const shots: CrewShot[] = orderedShots.map((s) => ({
    photoIndex: s.photoIndex,
    room: s.room,
    motionPrompt: `${s.motionHint}, ${MODE_MOTION[input.mode]}, photorealistic, gentle realistic camera movement, no warping`,
    caption: capByIdx.get(s.photoIndex) || s.room,
    narration: narrationByIdx.get(s.photoIndex) || ""
  }));

  return { title, musicMood: plan.musicMood, shots };
}
