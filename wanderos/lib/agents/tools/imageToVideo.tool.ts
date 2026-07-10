import { fal } from "@fal-ai/client";
import { spawn } from "child_process";
import { writeFile } from "fs/promises";
import { join } from "path";

/**
 * image→video tool — animates ONE real photo into a motion clip.
 *   primary:  fal Kling (real AI camera motion on the host's actual photo — the quality bar)
 *   fallback: ffmpeg Ken-Burns (pan/zoom) — free + reliable, so a render never hard-fails
 * Returns a LOCAL mp4 path (the FFmpeg compositor stitches local clips). Honest: motion only, never fabrication.
 */
export type Clip = { path: string; provider: "kling" | "ken-burns"; durationSec: number };

let configured = false;
function ensureFal() {
  if (!configured) {
    fal.config({ credentials: process.env.FAL_KEY });
    configured = true;
  }
}

async function download(url: string, dest: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status}: ${url}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

export function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args, { stdio: "ignore" });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });
}

/** Ken-Burns pan/zoom clip from a still image (the cost-free fallback motion). */
async function kenBurns(imageUrl: string, out: string, dur: number, workDir: string, i: number): Promise<Clip> {
  const img = join(workDir, `src-${i}.jpg`);
  await download(imageUrl, img);
  await ffmpeg([
    "-y", "-loop", "1", "-i", img,
    "-vf",
    `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=z='min(zoom+0.0012,1.4)':d=${dur * 25}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720,format=yuv420p`,
    "-t", String(dur), "-r", "25", out
  ]);
  return { path: out, provider: "ken-burns", durationSec: dur };
}

export async function animatePhoto(opts: {
  imageUrl: string;
  motionPrompt: string;
  durationSec?: number;
  workDir: string;
  index: number;
  preferKling?: boolean;
}): Promise<Clip> {
  const dur = opts.durationSec ?? 5;
  const out = join(opts.workDir, `clip-${opts.index}.mp4`);

  if (opts.preferKling !== false && process.env.FAL_KEY) {
    try {
      ensureFal();
      const model = process.env.FAL_KLING_MODEL || "fal-ai/kling-video/v2.1/pro/image-to-video";
      const r = (await fal.subscribe(model, {
        input: { image_url: opts.imageUrl, prompt: opts.motionPrompt, duration: String(dur) }
      })) as { data?: { video?: { url?: string } } };
      const url = r.data?.video?.url;
      if (url) {
        await download(url, out);
        return { path: out, provider: "kling", durationSec: dur };
      }
      throw new Error("Kling returned no video url");
    } catch (e) {
      console.warn(`[imageToVideo] Kling failed → Ken-Burns fallback: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return kenBurns(opts.imageUrl, out, dur, opts.workDir, opts.index);
}
