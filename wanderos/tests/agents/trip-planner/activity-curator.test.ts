/**
 * Agent test - trip-planner activity-curator.
 *   Run: npm run test:agent:trip-activity-curator
 *
 * Proves day architecture becomes concrete editable activity items with deterministic count/source bounds.
 */
import { readFileSync } from "fs";

for (const line of readFileSync(new URL("../../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("//") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { curateActivities } = await import("../../../lib/agents/crews/trip-planner/agents/activity-curator/agent");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── agent: trip-planner activity-curator (pro + deterministic slots) ──\n");

const input = {
  brief: {
    destination: "Tokyo",
    startDate: "2026-07-10",
    endDate: "2026-07-12",
    budget: 1600,
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
    budget: 1600,
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
    reasoning: "Normalized test profile."
  },
  destinationIntel: {
    destination: "Tokyo",
    neighborhoods: ["Asakusa", "Ueno", "Shinjuku"],
    themes: ["arrival food walk", "museum and market day", "skyline evening"],
    anchors: [
      { name: "Senso-ji market streets", area: "Asakusa", category: "culture", why: "Good low-pressure arrival walk." },
      { name: "Ueno Park museums", area: "Ueno", category: "museum", why: "Clustered museums with manageable walking." },
      { name: "Shinjuku skyline viewpoints", area: "Shinjuku", category: "viewpoint", why: "Strong night photography." }
    ],
    seasonalityNotes: ["July can be humid."],
    warnings: ["Avoid overpacking midday and stair-heavy routes."]
  },
  stayRecommendations: [
    {
      listingId: "11111111-1111-4111-8111-111111111111",
      title: "Tokyo Food Culture Loft",
      area: "Ueno",
      pricePerNight: 180,
      currency: "USD",
      maxGuests: 2,
      matchScore: 0.92,
      why: "Close to museums and food neighborhoods.",
      source: "pgvector",
      hardFiltersPassed: true
    }
  ],
  dayArchitecture: {
    days: [
      {
        dayNumber: 1,
        date: "2026-07-10",
        theme: "Arrival Food Walk & Local Charm",
        area: "Asakusa",
        energy: "low",
        targetItemCount: 3
      },
      {
        dayNumber: 2,
        date: "2026-07-11",
        theme: "Museums, Markets & Culture",
        area: "Ueno",
        energy: "high",
        targetItemCount: 4
      },
      {
        dayNumber: 3,
        date: "2026-07-12",
        theme: "Skyline Evening and Photography",
        area: "Shinjuku",
        energy: "low",
        targetItemCount: 3
      }
    ]
  }
};

const result = await curateActivities(input);

console.log("ActivityCuratorResult:", JSON.stringify(result, null, 2), "\n");

const perDay = new Map<number, number>();
for (const item of result.items) perDay.set(item.dayNumber, (perDay.get(item.dayNumber) || 0) + 1);
const text = JSON.stringify(result).toLowerCase();

result.items.length === 10 ? ok("exact target item count produced") : no(`items=${result.items.length}`);
perDay.get(1) === 3 && perDay.get(2) === 4 && perDay.get(3) === 3
  ? ok("items distributed by day architecture")
  : no(`distribution=${JSON.stringify(Object.fromEntries(perDay))}`);
result.items.every((item: { timeLabel?: string | null }) => Boolean(item.timeLabel?.trim()))
  ? ok("every item has a time label")
  : no("missing time label");
result.items.every((item: { title?: string }) => Boolean(item.title?.trim()))
  ? ok("every item has a title")
  : no("missing title");
result.items.every((item: { source?: string }) => item.source === "activity-curator")
  ? ok("all items source-owned by activity-curator")
  : no("wrong source");
result.items.every((item: { stayListingId?: string | null }) => !item.stayListingId)
  ? ok("activity curator did not attach stay listing ids")
  : no("stay listing id leaked into activity");
result.items.every((item: { estCost?: number }) => typeof item.estCost === "number" && item.estCost >= 0 && item.estCost <= 750)
  ? ok("all costs are bounded numeric estimates")
  : no("invalid cost estimate");
!/[<>]/.test(JSON.stringify(result)) ? ok("no HTML-like text") : no("HTML-like text found");
text.includes("shellfish") || !text.includes("seafood") ? ok("dietary constraint not contradicted") : no("dietary constraint contradicted");
result.reasoning && result.reasoning.length > 10 ? ok("reasoning produced") : no("reasoning missing");

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
