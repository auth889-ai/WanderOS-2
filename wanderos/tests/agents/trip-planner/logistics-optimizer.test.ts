/**
 * Agent test - trip-planner logistics-optimizer.
 *   Run: npm run test:agent:trip-logistics
 *
 * Proves activity candidates can be flow-optimized without changing day counts or inventing live logistics.
 */
import { readFileSync } from "fs";

for (const line of readFileSync(new URL("../../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("//") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { optimizeLogistics } = await import("../../../lib/agents/crews/trip-planner/agents/logistics-optimizer/agent");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── agent: trip-planner logistics-optimizer (flash + deterministic shape) ──\n");

const input = {
  brief: {
    destination: "Tokyo",
    startDate: "2026-07-10",
    endDate: "2026-07-11",
    budget: 1400,
    travelStyle: "food, culture, photography",
    interests: ["ramen", "museums", "night walks"],
    party: "couple",
    pace: "balanced",
    constraints: {
      accessibility: "avoid long stair climbs",
      dietary: "no shellfish"
    }
  },
  profile: {
    party: "couple",
    travelerCount: 2,
    budget: 1400,
    budgetBand: "midrange",
    pace: "balanced",
    interests: ["ramen", "museums", "night walks"],
    constraints: {
      accessibility: "avoid long stair climbs",
      dietary: "no shellfish"
    },
    travelStyle: "food, culture, photography",
    query: "Tokyo couple food culture photography midrange no shellfish avoid stairs",
    reasoning: "Normalized test profile."
  },
  destinationIntel: {
    destination: "Tokyo",
    neighborhoods: ["Asakusa", "Ueno", "Shinjuku"],
    themes: ["food neighborhoods", "museum mornings", "night walks"],
    anchors: [
      { name: "Senso-ji market streets", area: "Asakusa", category: "culture", why: "Compact culture/food area." },
      { name: "Ueno Park museums", area: "Ueno", category: "museum", why: "Clustered museums." },
      { name: "Shinjuku skyline", area: "Shinjuku", category: "viewpoint", why: "Evening photography." }
    ],
    seasonalityNotes: ["July can be humid."],
    warnings: ["Avoid stair-heavy routes and midday overpacking."]
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
      { dayNumber: 1, date: "2026-07-10", theme: "Arrival Food Walk", area: "Asakusa", energy: "low", targetItemCount: 3 },
      { dayNumber: 2, date: "2026-07-11", theme: "Museums and Night Views", area: "Ueno", energy: "high", targetItemCount: 4 }
    ]
  },
  items: [
    {
      dayNumber: 1,
      timeLabel: "Evening",
      title: "Dinner on Hoppy Street",
      description: "Casual izakaya dinner in Asakusa.",
      category: "food",
      source: "activity-curator",
      estCost: 35,
      locked: false,
      stayListingId: null
    },
    {
      dayNumber: 1,
      timeLabel: "Morning",
      title: "Senso-ji market streets",
      description: "A low-pressure arrival walk through the temple area.",
      category: "culture",
      source: "activity-curator",
      estCost: 0,
      locked: false,
      stayListingId: null
    },
    {
      dayNumber: 1,
      timeLabel: "Afternoon",
      title: "Nakamise-dori snacks",
      description: "Try small local snacks without shellfish.",
      category: "food",
      source: "activity-curator",
      estCost: 15,
      locked: false,
      stayListingId: null
    },
    {
      dayNumber: 2,
      timeLabel: "Evening",
      title: "Shinjuku skyline views",
      description: "Evening photography around skyline viewpoints.",
      category: "viewpoint",
      source: "activity-curator",
      estCost: 0,
      locked: false,
      stayListingId: null
    },
    {
      dayNumber: 2,
      timeLabel: "Morning",
      title: "Tokyo National Museum",
      description: "Museum morning in Ueno.",
      category: "museum",
      source: "activity-curator",
      estCost: 10,
      locked: false,
      stayListingId: null
    },
    {
      dayNumber: 2,
      timeLabel: "Lunch",
      title: "Ameya Yokocho lunch",
      description: "Casual lunch near Ueno.",
      category: "food",
      source: "activity-curator",
      estCost: 18,
      locked: false,
      stayListingId: null
    },
    {
      dayNumber: 2,
      timeLabel: "Afternoon",
      title: "Ueno Park walk",
      description: "Flat park walk to avoid heavy stairs.",
      category: "walk",
      source: "activity-curator",
      estCost: 0,
      locked: false,
      stayListingId: null
    }
  ]
};

const result = await optimizeLogistics(input);

console.log("LogisticsOptimizerResult:", JSON.stringify(result, null, 2), "\n");

const perDay = new Map<number, number>();
for (const item of result.items) perDay.set(item.dayNumber, (perDay.get(item.dayNumber) || 0) + 1);
const text = JSON.stringify(result).toLowerCase();

result.items.length === input.items.length ? ok("item count preserved") : no(`items=${result.items.length}`);
perDay.get(1) === 3 && perDay.get(2) === 4 ? ok("per-day counts preserved") : no(`distribution=${JSON.stringify(Object.fromEntries(perDay))}`);
result.items.every((item: { source?: string }) => item.source === "logistics-optimizer")
  ? ok("source updated to logistics-optimizer")
  : no("wrong source");
result.items.every((item: { stayListingId?: string | null }) => !item.stayListingId)
  ? ok("no stay listing ids attached")
  : no("stay listing id leaked");
result.items.every((item: { timeLabel?: string | null }) => Boolean(item.timeLabel?.trim()))
  ? ok("time labels preserved/assigned")
  : no("missing time label");
result.items.every((item: { estCost?: number }) => typeof item.estCost === "number" && item.estCost >= 0 && item.estCost <= 750)
  ? ok("costs remain bounded")
  : no("cost out of range");
!/[<>]/.test(JSON.stringify(result)) ? ok("no HTML-like text") : no("HTML-like text found");
!text.includes("guaranteed") && !/\b\d+\s*(min|minute|minutes)\b/.test(text)
  ? ok("no fake transit guarantees")
  : no("fake transit guarantee found");
result.warnings.length >= 1 ? ok("logistics warning included") : no("warnings missing");
result.reasoning && result.reasoning.length > 10 ? ok("reasoning produced") : no("reasoning missing");

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
