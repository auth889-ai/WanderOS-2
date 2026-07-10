/**
 * Agent test - trip-planner budget-optimizer.
 *   Run: npm run test:agent:trip-budget
 *
 * Proves deterministic budget math owns totals/fit while the model can only add advice.
 */
import { readFileSync } from "fs";

for (const line of readFileSync(new URL("../../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("//") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { optimizeBudget } = await import("../../../lib/agents/crews/trip-planner/agents/budget-optimizer/agent");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── agent: trip-planner budget-optimizer (deterministic math + reasoning advice) ──\n");

const baseInput = {
  brief: {
    destination: "Tokyo",
    startDate: "2026-07-10",
    endDate: "2026-07-13",
    budget: 1600,
    travelStyle: "food, culture, photography",
    interests: ["ramen", "museums", "night walks"],
    party: "couple",
    pace: "balanced",
    constraints: {
      dietary: "no shellfish"
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
      dietary: "no shellfish"
    },
    travelStyle: "food, culture, photography",
    query: "Tokyo couple food culture photography midrange",
    reasoning: "Normalized test profile."
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
      { dayNumber: 1, date: "2026-07-10", theme: "Arrival", area: "Asakusa", energy: "low", targetItemCount: 3 },
      { dayNumber: 2, date: "2026-07-11", theme: "Museums", area: "Ueno", energy: "high", targetItemCount: 4 },
      { dayNumber: 3, date: "2026-07-12", theme: "Skyline", area: "Shinjuku", energy: "medium", targetItemCount: 3 },
      { dayNumber: 4, date: "2026-07-13", theme: "Departure", area: "Ueno", energy: "low", targetItemCount: 3 }
    ]
  },
  items: [
    { dayNumber: 1, timeLabel: "Morning", title: "Senso-ji market streets", category: "culture", source: "logistics-optimizer", estCost: 0, locked: false, stayListingId: null },
    { dayNumber: 1, timeLabel: "Afternoon", title: "Nakamise snacks", category: "food", source: "logistics-optimizer", estCost: 20, locked: false, stayListingId: null },
    { dayNumber: 1, timeLabel: "Evening", title: "Casual dinner", category: "food", source: "logistics-optimizer", estCost: 35, locked: false, stayListingId: null },
    { dayNumber: 2, timeLabel: "Morning", title: "Tokyo National Museum", category: "museum", source: "logistics-optimizer", estCost: 15, locked: false, stayListingId: null },
    { dayNumber: 2, timeLabel: "Lunch", title: "Ueno lunch", category: "food", source: "logistics-optimizer", estCost: 18, locked: false, stayListingId: null },
    { dayNumber: 2, timeLabel: "Afternoon", title: "Ueno Park walk", category: "walk", source: "logistics-optimizer", estCost: 0, locked: false, stayListingId: null },
    { dayNumber: 2, timeLabel: "Evening", title: "Ramen dinner", category: "food", source: "logistics-optimizer", estCost: 18, locked: false, stayListingId: null },
    { dayNumber: 3, timeLabel: "Morning", title: "Shinjuku garden", category: "walk", source: "logistics-optimizer", estCost: 5, locked: false, stayListingId: null },
    { dayNumber: 3, timeLabel: "Afternoon", title: "Photo route", category: "walk", source: "logistics-optimizer", estCost: 0, locked: false, stayListingId: null },
    { dayNumber: 3, timeLabel: "Evening", title: "Skyline viewpoint", category: "viewpoint", source: "logistics-optimizer", estCost: 0, locked: false, stayListingId: null }
  ]
};

const fit = await optimizeBudget(baseInput);
const over = await optimizeBudget({
  ...baseInput,
  brief: { ...baseInput.brief, budget: 500 },
  profile: { ...baseInput.profile, budget: 500 },
  stayRecommendations: [{ ...baseInput.stayRecommendations[0], pricePerNight: 260 }],
  items: [
    ...baseInput.items,
    { dayNumber: 3, timeLabel: "Night", title: "Paid night photography deck", category: "viewpoint", source: "logistics-optimizer", estCost: 90, locked: false, stayListingId: null }
  ]
});

console.log("FitBudget:", JSON.stringify(fit, null, 2), "\n");
console.log("OverBudget:", JSON.stringify(over, null, 2), "\n");

const fitAllocations = Object.fromEntries(fit.allocations.map((line: { category: string; amount: number }) => [line.category, line.amount]));
const overAllocations = Object.fromEntries(over.allocations.map((line: { category: string; amount: number }) => [line.category, line.amount]));

fit.totalEstimate === 742 ? ok("fit total uses deterministic math") : no(`fit total=${fit.totalEstimate}`);
fit.budgetFit === "fit" ? ok("fit case classified as fit") : no(`fit=${fit.budgetFit}`);
fitAllocations.stay === 540 ? ok("stay total = 3 nights x 180") : no(`stay=${fitAllocations.stay}`);
fitAllocations.food === 91 ? ok("food total from food items") : no(`food=${fitAllocations.food}`);
fitAllocations.activities === 15 ? ok("activity total excludes free walks and food") : no(`activities=${fitAllocations.activities}`);
fitAllocations["local transit"] === 96 ? ok("transit buffer by day and traveler count") : no(`transit=${fitAllocations["local transit"]}`);
fit.allocations.length === 4 ? ok("four budget allocation lines") : no(`allocations=${fit.allocations.length}`);
fit.currency === "USD" ? ok("currency preserved") : no(`currency=${fit.currency}`);

over.totalEstimate === 1072 ? ok("over total uses deterministic math") : no(`over total=${over.totalEstimate}`);
over.budgetFit === "over_budget" ? ok("over case classified as over_budget") : no(`over=${over.budgetFit}`);
overAllocations.stay === 780 ? ok("over stay total = 3 nights x 260") : no(`over stay=${overAllocations.stay}`);
over.warnings.length >= 1 ? ok("over case includes warnings") : no("over warnings missing");
over.swapSuggestions.length >= 1 ? ok("over case includes swaps") : no("over swaps missing");
!JSON.stringify(over).toLowerCase().includes("flight") ? ok("does not invent flight budget") : no("flight budget invented");
!/[<>]/.test(JSON.stringify(over)) ? ok("no HTML-like text") : no("HTML-like text found");

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
