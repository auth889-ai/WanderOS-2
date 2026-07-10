/**
 * Agent test - trip-planner day-architect.
 *   Run: npm run test:agent:trip-day-architect
 *
 * Proves form dates + pace become a bounded, day-by-day architecture before activities are curated.
 */
import { readFileSync } from "fs";

for (const line of readFileSync(new URL("../../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("//") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { architectDays } = await import("../../../lib/agents/crews/trip-planner/agents/day-architect/agent");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── agent: trip-planner day-architect (flash + deterministic bounds) ──\n");

const result = await architectDays({
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
      accessibility: "avoid long stair climbs"
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
      accessibility: "avoid long stair climbs"
    },
    travelStyle: "food, culture, photography",
    query: "Tokyo couple food culture photography midrange no shellfish avoid stairs",
    reasoning: "Normalized the traveler brief into a couple-focused profile."
  },
  destinationIntel: {
    destination: "Tokyo",
    neighborhoods: ["Asakusa", "Ueno", "Shinjuku", "Ginza", "Yanaka"],
    themes: ["arrival food walk", "museum and market day", "photography neighborhoods", "skyline evening", "slow local finale"],
    anchors: [
      { name: "Senso-ji area", area: "Asakusa", category: "culture", why: "Good arrival anchor." },
      { name: "Ueno museums", area: "Ueno", category: "museum", why: "Strong museum cluster." },
      { name: "Shinjuku night views", area: "Shinjuku", category: "viewpoint", why: "Evening skyline." }
    ],
    seasonalityNotes: ["July can be humid; avoid overpacking midday."],
    warnings: ["Build in breaks for heat and stairs."]
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
  ]
});

console.log("DayArchitecture:", JSON.stringify(result, null, 2), "\n");

const dates = result.days.map((d: { date?: string | null }) => d.date);
const dayNumbers = result.days.map((d: { dayNumber: number }) => d.dayNumber);

result.days.length === 5 ? ok("inclusive date range produced 5 days") : no(`days=${result.days.length}`);
JSON.stringify(dayNumbers) === JSON.stringify([1, 2, 3, 4, 5]) ? ok("day numbers are exact") : no(`dayNumbers=${dayNumbers.join(",")}`);
JSON.stringify(dates) === JSON.stringify(["2026-07-10", "2026-07-11", "2026-07-12", "2026-07-13", "2026-07-14"])
  ? ok("dates match form input exactly")
  : no(`dates=${dates.join(",")}`);
result.days.every((d: { targetItemCount: number }) => d.targetItemCount >= 3 && d.targetItemCount <= 4)
  ? ok("balanced pace bounded to 3-4 target items")
  : no("target item count outside balanced bounds");
result.days.every((d: { theme?: string }) => Boolean(d.theme?.trim()))
  ? ok("every day has a theme")
  : no("missing day theme");
result.days.every((d: { area?: string | null }) => Boolean(d.area?.trim()))
  ? ok("every day has an area anchor")
  : no("missing area anchor");
result.days.some((d: { energy: string }) => d.energy === "low")
  ? ok("energy curve includes low-energy day")
  : no("no low-energy day");
result.reasoning && result.reasoning.length > 10 ? ok("reasoning produced") : no("reasoning missing");

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
