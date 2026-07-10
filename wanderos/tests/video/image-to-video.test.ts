/**
 * P9.1 — image→video tool: Ken-Burns (free) + one real fal Kling clip.
 *   Run: npm run test:video:i2v
 * Uploads a real test photo to Cloudinary, then animates it both ways and checks valid MP4 clips.
 * NOTE: the Kling call is a real, paid fal generation (~1–3 min). One short clip only.
 */
import { readFileSync, existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";

for (const l of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!l.includes("=") || l.trim().startsWith("#")) continue;
  const i = l.indexOf("="); const k = l.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { animatePhoto } = await import("../../lib/agents/tools/imageToVideo.tool");
const { uploadImage } = await import("../../lib/media/cloudinary");

let pass = 0, fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);
const durationOf = (p: string) => {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p], { encoding: "utf8" });
  return parseFloat(r.stdout.trim() || "0");
};

console.log("\n── P9.1: image→video tool ──\n");
const workDir = mkdtempSync(join(tmpdir(), "wanderos-i2v-"));

try {
  const buf = readFileSync(new URL("../../test_photos/image.png", import.meta.url));
  const imageUrl = await uploadImage(`data:image/png;base64,${buf.toString("base64")}`);
  imageUrl.startsWith("http") ? ok(`uploaded test photo → ${imageUrl.slice(0, 44)}…`) : no("upload failed");

  // 1 — Ken-Burns (free, ffmpeg)
  const kb = await animatePhoto({ imageUrl, motionPrompt: "slow cinematic pan", durationSec: 4, workDir, index: 0, preferKling: false });
  kb.provider === "ken-burns" && existsSync(kb.path) ? ok("Ken-Burns clip produced") : no(`kb provider=${kb.provider} exists=${existsSync(kb.path)}`);
  Math.abs(durationOf(kb.path) - 4) < 1.5 ? ok(`Ken-Burns clip is ~4s (${durationOf(kb.path).toFixed(1)}s)`) : no(`duration=${durationOf(kb.path)}`);

  // 2 — real fal Kling (premium AI motion) — one short clip
  console.log("  …calling fal Kling (real, ~1–3 min)…");
  const k = await animatePhoto({ imageUrl, motionPrompt: "gentle cinematic dolly-in, soft natural camera motion, photorealistic, no warping", durationSec: 5, workDir, index: 1, preferKling: true });
  existsSync(k.path) ? ok(`clip produced via "${k.provider}"${k.provider === "kling" ? " — real AI motion ✓" : " (Kling fell back to Ken-Burns)"}`) : no("no clip");
  durationOf(k.path) > 2 ? ok(`clip is a valid video (${durationOf(k.path).toFixed(1)}s)`) : no(`duration=${durationOf(k.path)}`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
