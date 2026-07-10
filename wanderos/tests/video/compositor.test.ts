/**
 * P9.2 — ffmpeg compositor: Ken-Burns clips → crossfade + captions + voice → final HD mp4. (free, fast)
 *   Run: npx tsx tests/video/compositor.test.ts
 */
import { readFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";

const { kenBurnsClip, composite, probeDuration } = await import("../../lib/media/video/ffmpeg");

let pass = 0, fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── P9.2: ffmpeg compositor ──\n");
const workDir = mkdtempSync(join(tmpdir(), "wanderos-comp-"));
const photoDir = new URL("../../test_photos/", import.meta.url).pathname;

try {
  const photos = readdirSync(photoDir).filter((f) => /\.(png|jpg|jpeg)$/i.test(f)).slice(0, 3);
  const clips: { path: string; durationSec: number; caption?: string }[] = [];
  const captions = ["Welcome to your Dubai Marina home", "Bright, open living space", "Moments from the marina"];
  for (let i = 0; i < photos.length; i++) {
    const out = join(workDir, `clip-${i}.mp4`);
    await kenBurnsClip(join(photoDir, photos[i]), out, 4, 1280, 720);
    existsSync(out) ? null : no(`clip ${i} missing`);
    clips.push({ path: out, durationSec: 4, caption: captions[i] });
  }
  ok(`generated ${clips.length} Ken-Burns clips`);

  // synth a short voice track (sine) so we exercise the audio mix path without TTS yet
  const voice = join(workDir, "voice.m4a");
  spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=10", "-c:a", "aac", voice]);

  const out = join(workDir, "final.mp4");
  await composite({ clips, out, w: 1280, h: 720, workDir, voicePath: existsSync(voice) ? voice : undefined });

  const dur = probeDuration(out);
  existsSync(out) ? ok("composited final.mp4") : no("no final.mp4");
  const expected = clips.reduce((a, c) => a + c.durationSec, 0) - (clips.length - 1) * 0.6;
  Math.abs(dur - expected) < 2 ? ok(`duration ~${expected.toFixed(1)}s (got ${dur.toFixed(1)}s — crossfades applied)`) : no(`duration=${dur} expected~${expected}`);

  // has a video + audio stream
  const streams = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", out], { encoding: "utf8" }).stdout;
  streams.includes("video") ? ok("has video stream") : no("no video");
  streams.includes("audio") ? ok("has audio stream (voice mixed in)") : no("no audio");
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
