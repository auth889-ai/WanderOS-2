import { readdirSync, existsSync } from "fs";
import { join } from "path";
import type { MusicProvider, VideoMode } from "../types";

/**
 * Royalty-free music library. Drop licensed tracks into /public/audio (optionally name them by mood,
 * e.g. warm-1.mp3, cinematic-1.mp3). Picks by mode/mood; returns null if the library is empty (render
 * still ships with voice + motion). Keeps us legal — no copyrighted/"trending" tracks.
 */
const MOOD_BY_MODE: Record<VideoMode, string> = {
  walkthrough: "warm",
  day_to_dusk: "cinematic",
  staging_reveal: "upbeat",
  drone: "epic",
  social_reel: "upbeat"
};

export class LibraryMusicProvider implements MusicProvider {
  id = "library";
  constructor(private dir = join(process.cwd(), "public", "audio")) {}

  async pick(mode: VideoMode, mood: string | undefined): Promise<{ path: string; trackId: string } | null> {
    if (!existsSync(this.dir)) return null;
    const files = readdirSync(this.dir).filter((f) => /\.(mp3|m4a|aac|wav)$/i.test(f));
    if (!files.length) return null;
    const want = (mood || MOOD_BY_MODE[mode] || "").toLowerCase();
    const match = files.find((f) => want && f.toLowerCase().includes(want)) || files[0];
    return { path: join(this.dir, match), trackId: match };
  }
}
