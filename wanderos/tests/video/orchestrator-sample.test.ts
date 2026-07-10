/**
 * P10 proof — the full vision-grounded crew render via the orchestrator.
 *   FREE (Ken-Burns):  npx tsx tests/video/orchestrator-sample.test.ts
 *   Veo (paid):        VIDEO_ENGINE=premium npx tsx tests/video/orchestrator-sample.test.ts
 * Proves: length scales with content (all photos) + voice describes the room actually on screen.
 */
import { readFileSync, readdirSync } from "fs";
import { spawnSync } from "child_process";

for (const l of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!l.includes("=") || l.trim().startsWith("#")) continue;
  const i = l.indexOf("="); const k = l.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { uploadImage } = await import("../../lib/media/cloudinary");
const { runListingVideo } = await import("../../lib/agents/video/orchestrator");
const { MotionRouter } = await import("../../lib/agents/video/providers/motion");

const ENGINE = (process.env.VIDEO_ENGINE || "kenburns").toLowerCase();
const photoDir = new URL("../../test_photos/", import.meta.url).pathname;

console.log(`\n── P10 proof: vision-grounded crew render · engine=${ENGINE} ──\n`);

const files = readdirSync(photoDir).filter((f) => /\.(png|jpe?g)$/i.test(f));
const photoUrls: string[] = [];
for (const f of files) {
  const buf = readFileSync(`${photoDir}${f}`);
  photoUrls.push(await uploadImage(`data:image/png;base64,${buf.toString("base64")}`));
}
console.log(`✓ uploaded ${photoUrls.length} real photos\n`);

const res = await runListingVideo({
  brief: { mode: "walkthrough", resolution: "1080p", photoUrls, narration: "A bright, family-friendly villa moments from Dubai Marina." },
  listingTitle: "Charming Family Villa in Dubai Marina",
  city: "Dubai",
  router: ENGINE === "premium" ? MotionRouter.premium() : MotionRouter.budget(),
  onProgress: (stage, d) => console.log(`  · ${stage}${d ? " " + JSON.stringify(d) : ""}`)
});

console.log(`\n── storyboard (voice ↔ room match) ──`);
res.manifest.shots.forEach((s, i) => console.log(`  shot ${i} [${s.provider}] room="${s.room}"\n     caption: ${s.caption}\n     voice  : ${s.narration}`));

console.log(`\n🎬 VIDEO READY  (${res.durationSec.toFixed(1)}s · ${res.manifest.shots.length} shots · ~$${(res.costCents / 100).toFixed(2)})`);
console.log(`   ${res.url}`);
spawnSync("bash", ["-c", `curl -s "${res.url}" -o /tmp/wanderos-tour.mp4`]);
console.log(`   saved /tmp/wanderos-tour.mp4\n`);
process.exit(0);
