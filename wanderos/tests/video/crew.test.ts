/**
 * Verifies the multi-agent video crew runs (LLM-only, no render). ~$0.05.
 *   npx tsx tests/video/crew.test.ts
 */
import { readFileSync, readdirSync } from "fs";
for (const l of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!l.includes("=") || l.trim().startsWith("#")) continue;
  const i = l.indexOf("="); const k = l.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^"|"$/g, "");
}
const { uploadImage } = await import("../../lib/media/cloudinary");
const { runVideoCrew } = await import("../../lib/agents/video/crew");

const dir = new URL("../../test_photos/", import.meta.url).pathname;
const urls: string[] = [];
for (const f of readdirSync(dir).filter((f) => /\.(png|jpe?g)$/i.test(f))) {
  urls.push(await uploadImage(`data:image/png;base64,${readFileSync(`${dir}${f}`).toString("base64")}`));
}
console.log(`\n── multi-agent video crew · ${urls.length} photos ──\n`);

const out = await runVideoCrew({
  photoUrls: urls, mode: "walkthrough", narrate: true,
  listingTitle: "Charming Family Villa in Dubai Marina", city: "Dubai",
  onAgent: (a) => console.log(`  ▸ agent running: ${a}`)
});

console.log(`\ntitle: ${out.title}\nmusic: ${out.musicMood}\nshots: ${out.shots.length}\n`);
out.shots.forEach((s, i) => console.log(`  ${i}. ${s.room}\n     caption: ${s.caption}\n     voice  : ${s.narration}\n     motion : ${s.motionPrompt}`));
process.exit(0);
