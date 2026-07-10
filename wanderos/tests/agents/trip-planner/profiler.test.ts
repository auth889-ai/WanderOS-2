/**
 * Agent test - trip-planner profiler (Groq extract tier).
 *   Run: npm run test:agent:trip-profiler
 */
import { readFileSync } from "fs";

for (const line of readFileSync(new URL("../../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("//") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { profileTrip } = await import("../../../lib/agents/crews/trip-planner/agents/profiler/agent");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── agent: trip-planner profiler (extract) ──\n");

const profile = await profileTrip({
  destination: "Tokyo",
  startDate: "2026-07-10",
  endDate: "2026-07-14",
  budget: 2200,
  travelStyle: "food, culture, photography",
  interests: ["ramen", "museums", "night walks", "ramen"],
  party: "couple",
  pace: "balanced",
  constraints: {
    dietary: "no shellfish",
    accessibility: "avoid long stair climbs",
    avoid: ["expensive fine dining"]
  }
});

console.log("ProfilerResult:", JSON.stringify(profile, null, 2), "\n");

profile.party.length > 0 ? ok("party normalized") : no("party missing");
profile.pace === "balanced" ? ok("pace preserved") : no(`pace=${profile.pace}`);
Array.isArray(profile.interests) && profile.interests.length >= 3 ? ok("interests normalized") : no(`interests=${profile.interests?.length}`);
new Set(profile.interests.map((i: string) => i.toLowerCase())).size === profile.interests.length
  ? ok("interests de-duplicated")
  : no("interests contain duplicates");
["budget", "midrange", "premium", "luxury"].includes(profile.budgetBand || "")
  ? ok("budgetBand classified")
  : no(`budgetBand=${profile.budgetBand}`);
profile.query.toLowerCase().includes("tokyo") ? ok("query includes destination") : no(`query=${profile.query}`);
profile.query.toLowerCase().includes("couple") ? ok("query includes party") : no(`query=${profile.query}`);
JSON.stringify(profile.constraints).toLowerCase().includes("shellfish") ? ok("dietary constraint preserved") : no("dietary constraint missing");
profile.reasoning && profile.reasoning.length > 10 ? ok("reasoning produced") : no("reasoning missing");

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
