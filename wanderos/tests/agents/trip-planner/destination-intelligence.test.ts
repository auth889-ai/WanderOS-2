/**
 * Agent test - trip-planner destination-intelligence (pro tier).
 *   Run: npm run test:agent:trip-destination
 */
import { readFileSync } from "fs";

for (const line of readFileSync(new URL("../../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("//") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { destinationIntelligence } = await import("../../../lib/agents/crews/trip-planner/agents/destination-intelligence/agent");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── agent: trip-planner destination-intelligence (pro) ──\n");

const result = await destinationIntelligence({
  brief: {
    destination: "Tokyo",
    startDate: "2026-07-10",
    endDate: "2026-07-14",
    budget: 2200,
    travelStyle: "food, culture, photography",
    interests: ["ramen", "museums", "night walks"],
    party: "couple",
    pace: "balanced",
    constraints: {
      dietary: "no shellfish",
      accessibility: "avoid long stair climbs",
      avoid: ["expensive fine dining"]
    }
  },
  profile: {
    party: "couple",
    travelerCount: 2,
    budget: 2200,
    budgetBand: "midrange",
    pace: "balanced",
    interests: ["ramen", "museums", "night walks"],
    constraints: {
      dietary: "no shellfish",
      accessibility: "avoid long stair climbs",
      avoid: ["expensive fine dining"]
    },
    travelStyle: "food, culture, photography",
    query: "Tokyo couple food culture photography midrange no shellfish avoid stairs",
    reasoning: "Normalized the traveler brief into a couple-focused food and culture planning profile."
  }
});

console.log("DestinationIntelligence:", JSON.stringify(result, null, 2), "\n");

result.destination.toLowerCase().includes("tokyo") ? ok("destination preserved") : no(`destination=${result.destination}`);
result.neighborhoods.length >= 3 ? ok("3+ planning neighborhoods") : no(`neighborhoods=${result.neighborhoods.length}`);
result.themes.length >= 3 ? ok("3+ trip themes") : no(`themes=${result.themes.length}`);
result.anchors.length >= 3 ? ok("3+ destination anchors") : no(`anchors=${result.anchors.length}`);
result.anchors.every((a: { name?: string }) => Boolean(a.name?.trim())) ? ok("anchors have names") : no("anchor without name");
JSON.stringify(result).toLowerCase().includes("food") || JSON.stringify(result).toLowerCase().includes("ramen")
  ? ok("food interest reflected")
  : no("food interest not reflected");
result.warnings.length >= 1 ? ok("planning warnings included") : no("warnings missing");
!JSON.stringify(result).toLowerCase().includes("listingid") ? ok("no listing ids invented") : no("invented listing ids");

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
