/**
 * P9 proof — render ONE real promo video end-to-end: motion → voice → music → compositor → Cloudinary.
 *   FREE (full pipeline, $0):  npx tsx tests/video/sample-render.test.ts
 *   Veo (premium motion, paid): VIDEO_ENGINE=premium npx tsx tests/video/sample-render.test.ts
 *   Kling (paid):               VIDEO_ENGINE=kling   npx tsx tests/video/sample-render.test.ts
 * This is a hand-wired storyboard; P10 replaces it with the LLM crew (shot-vision/storyboard/captions).
 */
import { readFileSync, mkdtempSync, rmSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";

for (const l of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!l.includes("=") || l.trim().startsWith("#")) continue;
  const i = l.indexOf("="); const k = l.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { uploadImage } = await import("../../lib/media/cloudinary");
const { MotionRouter } = await import("../../lib/agents/video/providers/motion");
const { GeminiTTSProvider } = await import("../../lib/agents/video/providers/tts");
const { LibraryMusicProvider } = await import("../../lib/agents/video/providers/music");
const { composite, probeDuration } = await import("../../lib/media/video/ffmpeg");
const { uploadVideo } = await import("../../lib/media/video/cloudinaryVideo");
const { RES } = await import("../../lib/agents/video/types");

const ENGINE = (process.env.VIDEO_ENGINE || "kenburns").toLowerCase(); // kenburns(free) | premium(veo) | kling
const RESOLUTION = "720p" as const;
const { w, h } = RES[RESOLUTION];

console.log(`\n── P9 proof: render one promo video · engine=${ENGINE} ──\n`);
const workDir = mkdtempSync(join(tmpdir(), "wanderos-sample-"));
const photoDir = new URL("../../test_photos/", import.meta.url).pathname;

try {
  // 1) host's real photos → Cloudinary URLs (providers need a public URL)
  const files = readdirSync(photoDir).filter((f) => /\.(png|jpe?g)$/i.test(f)).slice(0, 3);
  const urls: string[] = [];
  for (const f of files) {
    const buf = readFileSync(join(photoDir, f));
    urls.push(await uploadImage(`data:image/png;base64,${buf.toString("base64")}`));
  }
  console.log(`✓ uploaded ${urls.length} real photos`);

  // 2) hand-wired storyboard (P10 = LLM crew). Motion prompts + captions + narration script.
  const captions = ["Welcome to your Dubai Marina home", "Bright, family-friendly living space", "Moments from the Marina Walk"];
  const prompts = [
    "slow cinematic dolly-in revealing the bright open-plan living space, soft natural light, gentle realistic camera motion, no warping",
    "smooth slow pan across the warm inviting family living area, photorealistic, subtle parallax",
    "slow push-in toward the window and skyline view, cinematic, gentle motion"
  ];
  const narration = "Welcome to your stylish sanctuary in Dubai Marina. Step into a bright, open living space designed for families, with modern comforts throughout. Just moments from the Marina Walk, world-class dining, and the waterfront. Your next stay starts here.";

  // 3) render shots (motion) via the router
  const router = ENGINE === "premium" ? MotionRouter.premium() : ENGINE === "kling" ? new (await import("../../lib/agents/video/providers/motion")).MotionRouter([new (await import("../../lib/agents/video/providers/motion")).KlingProvider(), new (await import("../../lib/agents/video/providers/motion")).KenBurnsProvider()]) : MotionRouter.budget();
  const clips: { path: string; durationSec: number; caption?: string }[] = [];
  for (let i = 0; i < urls.length; i++) {
    const t0 = Date.now();
    const clip = await router.render({ i, photoUrl: urls[i], photoHash: "", motionPrompt: prompts[i], durationSec: 5 }, { mode: "walkthrough", resolution: RESOLUTION, workDir });
    console.log(`✓ shot ${i} via "${clip.provider}" (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    clips.push({ path: clip.path, durationSec: clip.durationSec, caption: captions[i] });
  }

  // 4) voice (Gemini TTS)
  let voicePath: string | undefined;
  try {
    const tts = new GeminiTTSProvider();
    const v = await tts.synthesize(narration, join(workDir, "voice.m4a"));
    voicePath = v.path;
    console.log(`✓ voiceover (${v.durationSec.toFixed(1)}s)`);
  } catch (e) { console.log(`• voice skipped: ${e instanceof Error ? e.message : e}`); }

  // 5) music (optional, royalty-free library)
  const music = await new LibraryMusicProvider().pick("walkthrough", undefined);
  console.log(music ? `✓ music: ${music.trackId}` : "• no music (drop tracks in public/audio)");

  // 6) compose → final HD mp4
  const out = join(workDir, "final.mp4");
  await composite({ clips, out, w, h, workDir, voicePath, musicPath: music?.path });
  console.log(`✓ composed final.mp4 (${probeDuration(out).toFixed(1)}s)`);

  // 7) publish to Cloudinary + save local + frame
  const pub = await uploadVideo(out);
  spawnSync("cp", [out, "/tmp/wanderos-sample.mp4"]);
  spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", out, "-vf", "select=eq(n\\,40)", "-vframes", "1", "/tmp/wanderos-sample-frame.png"]);

  console.log(`\n🎬 VIDEO READY`);
  console.log(`   Cloudinary: ${pub.url}`);
  console.log(`   Thumbnail : ${pub.thumbnailUrl}`);
  console.log(`   Local     : /tmp/wanderos-sample.mp4`);
  console.log(`   Frame     : /tmp/wanderos-sample-frame.png\n`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
process.exit(0);
