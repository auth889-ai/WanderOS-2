/**
 * Crew integration test — the FULL Host Studio LangGraph (10 nodes, one run).
 *   Run: npm run test:crew
 * Proves the graph runs end-to-end (photos+notes -> validated ListingDraft) AND that every node
 * was logged to agent_steps (the observable trace). Lean linear crew: no supervisor, no critic loop.
 */
import { readFileSync } from "fs";
import { randomUUID } from "crypto";

for (const line of readFileSync(new URL("../../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("//") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { queryAurora } = await import("../../../lib/db/pool");
const { runHostStudio } = await import("../../../lib/agents/crews/host-studio/index");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n══════ CREW: Host Studio (full LangGraph, 10 nodes) ══════\n");

const listingId = randomUUID();
const t0 = Date.now();

// load the host's real photos from test_photos/ as data URIs
const photoFiles = ["image.png", "image copy.png", "image copy 2.png", "image copy 3.png", "image copy 4.png"];
const photos = photoFiles.map((name) => {
  const buf = readFileSync(new URL(`../../../test_photos/${name}`, import.meta.url));
  return `data:image/png;base64,${buf.toString("base64")}`;
});
console.log(`Loaded ${photos.length} real property photos.\n`);

try {
  const result = await runHostStudio({
    userId: null,
    listingId,
    category: "apartment",
    city: "Dubai",
    country: "United Arab Emirates",
    notes: "Modern, upscale apartment with city skyline views, floor-to-ceiling windows, a designer bathroom, an open-plan dining and living area, air conditioning, and stylish bedrooms. Centrally located. No smoking.",
    photos
  });

  console.log(`\nDraft (in ${((Date.now() - t0) / 1000).toFixed(1)}s):`, JSON.stringify(result.draft, null, 2), "\n");

  result.runId ? ok(`crew ran as ONE agent_run (${result.runId})`) : no("no runId");
  result.draft?.title?.length > 0 ? ok("produced a listing title") : no("no title");
  result.draft?.price > 0 ? ok(`priced it (${result.draft.price} ${result.draft.currency})`) : no("no price");
  result.draft?.bedrooms >= 1 ? ok(`extracted facts (${result.draft.bedrooms}BR, sleeps ${result.draft.maxGuests})`) : no("no facts");
  result.draft?.tags?.length > 0 ? ok("tagged the listing") : no("no tags");
  ["approve", "flag", "reject"].includes(result.draft?.safetyVerdict) ? ok(`safety reviewed (${result.draft.safetyVerdict})`) : no("no safety verdict");
  typeof result.draft?.readyToPublish === "boolean" ? ok(`composed a host handoff (ready=${result.draft.readyToPublish})`) : no("no handoff");
  result.gateValid ? ok("quality-gate passed the assembled draft") : no("quality-gate failed the draft");

  // Airbnb-depth detail
  console.log("\nROOM BREAKDOWN:", result.details?.roomBreakdown?.map((r) => `${r.name}(${r.details.length})`).join(", "));
  console.log("LOCATION:", result.details?.locationHighlights?.attractions?.slice(0, 3).join(", "), "\n");
  result.details?.roomBreakdown?.length > 0 ? ok(`Airbnb-depth: ${result.details.roomBreakdown.length}-room breakdown`) : no("no room breakdown");
  result.details?.houseRules?.maxGuests >= 0 ? ok("house rules generated") : no("no house rules");
  Array.isArray(result.details?.unavailable) ? ok("unavailable/safety items listed") : no("no unavailable list");

  // the observable trace: every node logged to agent_steps
  const steps = await queryAurora<{ agent_name: string; status: string }>(
    "select agent_name, status from agent_steps where run_id = $1 order by sequence",
    [result.runId]
  );
  console.log("\nTRACE (agent_steps):", steps.map((s) => `${s.agent_name}:${s.status}`).join(" → "), "\n");
  steps.length >= 10 ? ok(`trace logged ${steps.length} node executions (>= 10)`) : no(`only ${steps.length} steps traced`);
  steps.every((s) => s.status === "completed") ? ok("every node completed") : no("some node failed in the trace");
} finally {
  await queryAurora("delete from embeddings where owner_id = $1", [listingId]);
}

console.log(`\n══════ ${pass} passed, ${fail} failed ══════\n`);
process.exit(fail ? 1 : 0);
