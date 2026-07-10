import { GoogleGenAI } from "@google/genai";
import { fal } from "@fal-ai/client";
import { writeFile } from "fs/promises";
import { join } from "path";
import { kenBurnsClip, download } from "../../../media/video/ffmpeg";
import { RES, type MotionProvider, type Shot, type RenderOpts, type RenderedClip, type VideoMode } from "../types";

/**
 * image→video motion engines behind one interface (docs/VIDEO_HLD.md §5). All operate on the host's REAL
 * photo (image→video, never text→video). MotionRouter tries them in order with failover.
 *   Veo 3.1 (Vertex) = primary · fal Kling v2.1 pro = budget/failover · ffmpeg Ken-Burns = free fallback
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const aspectFor = (m: VideoMode) => (m === "social_reel" ? "9:16" : "16:9");

async function fetchImageBase64(url: string): Promise<{ b64: string; mime: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image fetch ${res.status}`);
  const mime = res.headers.get("content-type") || "image/jpeg";
  return { b64: Buffer.from(await res.arrayBuffer()).toString("base64"), mime };
}

/** Ken-Burns pan/zoom — free, always works. */
export class KenBurnsProvider implements MotionProvider {
  id = "ken-burns";
  supports() { return true; }
  async render(shot: Shot, opts: RenderOpts): Promise<RenderedClip> {
    const { w, h } = RES[opts.resolution];
    const img = join(opts.workDir, `src-${shot.i}.jpg`);
    await download(shot.photoUrl, img);
    const out = join(opts.workDir, `clip-${shot.i}.mp4`);
    await kenBurnsClip(img, out, shot.durationSec, w, h);
    return { path: out, provider: this.id, costCents: 0, durationSec: shot.durationSec };
  }
}

/** fal Kling v2.1 pro — faithful AI motion on the real photo. */
export class KlingProvider implements MotionProvider {
  id = "kling";
  private configured = false;
  supports() { return !!process.env.FAL_KEY; }
  async render(shot: Shot, opts: RenderOpts): Promise<RenderedClip> {
    if (!this.configured) { fal.config({ credentials: process.env.FAL_KEY }); this.configured = true; }
    const model = process.env.FAL_KLING_MODEL || "fal-ai/kling-video/v2.1/pro/image-to-video";
    const klingDur = shot.durationSec <= 7 ? "5" : "10"; // Kling only accepts "5" or "10"
    const r = (await fal.subscribe(model, {
      input: { image_url: shot.photoUrl, prompt: shot.motionPrompt, duration: klingDur }
    })) as { data?: { video?: { url?: string } } };
    const url = r.data?.video?.url;
    if (!url) throw new Error("Kling returned no video url");
    const out = join(opts.workDir, `clip-${shot.i}.mp4`);
    await download(url, out);
    return { path: out, provider: this.id, costCents: 50, durationSec: Number(klingDur) };
  }
}

/** Veo 3.1 (Vertex AI) — primary premium engine, image→video + native audio. */
export class VeoProvider implements MotionProvider {
  id = "veo-3.1";
  private ai: GoogleGenAI | null = null;
  supports() { return !!(process.env.GOOGLE_PROJECT_ID && process.env.GOOGLE_LOCATION); }
  private client() {
    if (!this.ai) this.ai = new GoogleGenAI({ vertexai: true, project: process.env.GOOGLE_PROJECT_ID, location: process.env.GOOGLE_LOCATION });
    return this.ai;
  }
  async render(shot: Shot, opts: RenderOpts): Promise<RenderedClip> {
    const ai = this.client();
    const { b64, mime } = await fetchImageBase64(shot.photoUrl);
    const dur = Math.min(8, Math.max(4, Math.round(shot.durationSec)));
    const out = join(opts.workDir, `clip-${shot.i}.mp4`);
    let lastErr = "";
    // Veo occasionally returns an empty op → retry (keeps every shot premium instead of dropping to fallback)
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let op: any = await ai.models.generateVideos({
          model: process.env.VEO_MODEL || "veo-3.1-fast-generate-001",
          prompt: shot.motionPrompt,
          image: { imageBytes: b64, mimeType: mime },
          config: { aspectRatio: aspectFor(opts.mode), durationSeconds: dur, numberOfVideos: 1 }
        } as never);
        let tries = 0;
        while (!op.done && tries++ < 60) { await sleep(10000); op = await ai.operations.getVideosOperation({ operation: op }); }
        const v = op.response?.generatedVideos?.[0]?.video;
        const bytes = v?.videoBytes || v?.bytesBase64Encoded;
        if (bytes) {
          await writeFile(out, Buffer.from(bytes, "base64"));
          return { path: out, provider: this.id, costCents: 120, durationSec: dur };
        }
        lastErr = "no video bytes";
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
      console.warn(`[veo] attempt ${attempt}/3 failed (${lastErr}) — retrying`);
    }
    throw new Error(`Veo failed after retries: ${lastErr}`);
  }
}

/** Ordered providers + failover. Records which engine actually produced each clip. */
export class MotionRouter {
  constructor(private providers: MotionProvider[]) {}
  /** PRODUCT chain: Kling → Veo, premium only — NO Ken-Burns, so output is never shaky.
   *  (Kling first: reliable + smooth + not Veo-quota-limited; Veo as the alternate premium engine.) */
  static premium() { return new MotionRouter([new KlingProvider(), new VeoProvider()]); }
  /** free local testing ONLY (never the product path) — pan/zoom, can shake */
  static budget() { return new MotionRouter([new KenBurnsProvider()]); }

  async render(shot: Shot, opts: RenderOpts): Promise<RenderedClip> {
    let lastErr: unknown;
    for (const p of this.providers) {
      if (!p.supports(opts.mode)) continue;
      try { return await p.render(shot, opts); }
      catch (e) { lastErr = e; console.warn(`[motion] ${p.id} failed → next: ${e instanceof Error ? e.message : String(e)}`); }
    }
    throw new Error(`all motion providers failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
  }
}
