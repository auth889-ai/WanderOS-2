/** Listing-video domain contracts (see docs/VIDEO_HLD.md §9). Stable interfaces everything builds on. */

export type VideoMode = "walkthrough" | "day_to_dusk" | "staging_reveal" | "drone" | "social_reel";
export type Resolution = "720p" | "1080p";

export const RES: Record<Resolution, { w: number; h: number }> = {
  "720p": { w: 1280, h: 720 },
  "1080p": { w: 1920, h: 1080 }
};

/** Host inputs for a render. */
export interface VideoBrief {
  mode: VideoMode;
  resolution: Resolution;
  photoUrls: string[];
  order?: number[];
  musicMood?: string;
  captionStyle?: string;
  narration?: string; // "what to say"
}

/** One unit of work in the render manifest. */
export interface Shot {
  i: number;
  photoUrl: string;
  photoHash: string;
  motionPrompt: string;
  durationSec: number;
  caption?: string;
}

export interface RenderedClip {
  path: string; // local mp4 (compositor stitches local files)
  provider: string;
  costCents: number;
  durationSec: number;
  requestId?: string;
}

export interface RenderOpts {
  mode: VideoMode;
  resolution: Resolution;
  workDir: string;
}

/** Swappable motion engine (Veo · Kling · Ken-Burns) behind a router with failover. */
export interface MotionProvider {
  id: string;
  supports(mode: VideoMode): boolean;
  render(shot: Shot, opts: RenderOpts): Promise<RenderedClip>;
}

export interface TTSProvider {
  id: string;
  synthesize(script: string, outPath: string): Promise<{ path: string; durationSec: number; costCents: number }>;
}

export interface MusicProvider {
  id: string;
  pick(mode: VideoMode, mood: string | undefined, outDir: string): Promise<{ path: string; trackId: string } | null>;
}
