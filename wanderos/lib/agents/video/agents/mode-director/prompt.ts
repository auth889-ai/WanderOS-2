import type { VideoMode } from "../../types";
import type { Perceived } from "../shot-vision/schema";

const MODE_NOTE: Record<VideoMode, string> = {
  walkthrough: "smooth room-to-room walkthrough, calm inviting pace",
  day_to_dusk: "warm twilight mood, emphasize light & ambiance",
  staging_reveal: "reveal how the space lives, highlight furnishing & flow",
  drone: "scale-forward, exteriors & wide reveals first",
  social_reel: "punchy, fast, scroll-stopping, short shots"
};

export function buildModeDirectorPrompt(perceived: Perceived, mode: VideoMode): string {
  const rooms = perceived.shots.map((s) => `#${s.photoIndex}: ${s.room} — ${s.features.join(", ")}`).join("\n");
  return `You are an award-winning property VIDEO DIRECTOR. Mode: ${mode} (${MODE_NOTE[mode]}).
Available shots:
${rooms}

Decide the tour: orderedPhotoIndexes = open on the most striking shot, flow room-to-room, end on a highlight. DROP near-duplicate photos — never show the same room twice. Pick musicMood + pacing fitting the mode, and a one-line styleNote.`;
}
