/**
 * Agent test - trip-planner verifier. Deterministic Zod/business gate (no LLM, no DB).
 *   Run: npm run test:agent:trip-verifier
 */
export {};

const { verifyTripPlan } = await import("../../../lib/agents/crews/trip-planner/verifier");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── agent: trip-planner verifier ──\n");

const baseInput = {
  destination: "Tokyo",
  startDate: "2026-07-10",
  endDate: "2026-07-12",
  budget: 1200,
  profile: {
    party: "couple",
    pace: "balanced",
    interests: ["ramen", "museums"],
    constraints: { dietary: "no shellfish" },
    budget: 1200,
    travelStyle: "food-culture"
  }
};

const plan = {
  totalEstimate: 180,
  days: [
    { dayNumber: 1, date: "2026-07-10", theme: "Arrival food walk", summary: "Arrival and food orientation.", area: "Shinjuku" },
    { dayNumber: 2, date: "2026-07-11", theme: "Museum and culture", summary: "Culture anchors and neighborhood walk.", area: "Ueno" },
    { dayNumber: 3, date: "2026-07-12", theme: "Markets and skyline", summary: "Food markets and evening view.", area: "Shibuya" }
  ],
  items: [
    { dayNumber: 1, timeLabel: "Morning", title: "Shinjuku arrival orientation", description: "Settle in and learn the transit anchor.", category: "logistics", source: "test", estCost: 10, locked: false, stayListingId: null },
    { dayNumber: 1, timeLabel: "Afternoon", title: "Shinjuku Gyoen", description: "Low-pressure garden stop.", category: "garden", source: "test", estCost: 15, locked: false, stayListingId: null },
    { dayNumber: 2, timeLabel: "Morning", title: "Tokyo National Museum", description: "Cultural anchor.", category: "museum", source: "test", estCost: 20, locked: false, stayListingId: null },
    { dayNumber: 2, timeLabel: "Evening", title: "Ueno food lane", description: "Diet-aware casual dinner.", category: "food", source: "test", estCost: 45, locked: false, stayListingId: null },
    { dayNumber: 3, timeLabel: "Morning", title: "Market breakfast route", description: "Casual market exploration.", category: "market", source: "test", estCost: 35, locked: false, stayListingId: null },
    { dayNumber: 3, timeLabel: "Evening", title: "Skyline viewpoint", description: "Evening city view.", category: "viewpoint", source: "test", estCost: 55, locked: false, stayListingId: null }
  ]
};
const r1 = verifyTripPlan({
  destination: baseInput.destination,
  startDate: baseInput.startDate,
  endDate: baseInput.endDate,
  pace: baseInput.profile.pace,
  budget: baseInput.budget,
  totalEstimate: plan.totalEstimate,
  days: plan.days,
  items: plan.items
});
r1.status === "passed" ? ok("valid structurally generated plan passes") : no(`valid plan failed: ${r1.errors.join("; ")}`);
r1.metrics.dayCount === 3 ? ok("metrics day count recorded") : no(`dayCount=${r1.metrics.dayCount}`);
r1.metrics.itemCount >= 6 ? ok("metrics item count recorded") : no(`itemCount=${r1.metrics.itemCount}`);

const r2 = verifyTripPlan({
  destination: baseInput.destination,
  startDate: baseInput.startDate,
  endDate: baseInput.endDate,
  pace: baseInput.profile.pace,
  days: plan.days.slice(0, 2),
  items: plan.items,
  totalEstimate: plan.totalEstimate
});
r2.status === "failed" && r2.errors.some((e: string) => e.includes("day count"))
  ? ok("wrong day count fails")
  : no(`wrong day count not caught: ${r2.errors.join("; ")}`);

const r3 = verifyTripPlan({
  destination: baseInput.destination,
  startDate: baseInput.startDate,
  endDate: baseInput.endDate,
  pace: baseInput.profile.pace,
  days: plan.days,
  items: [{ ...plan.items[0], dayNumber: 4 }],
  totalEstimate: plan.totalEstimate
});
r3.status === "failed" && r3.errors.some((e: string) => e.includes("missing day"))
  ? ok("item pointing to missing day fails")
  : no(`missing day not caught: ${r3.errors.join("; ")}`);

const r4 = verifyTripPlan({
  destination: baseInput.destination,
  startDate: baseInput.startDate,
  endDate: baseInput.endDate,
  pace: baseInput.profile.pace,
  days: plan.days,
  items: [{ ...plan.items[0], title: "<script>bad</script>" }],
  totalEstimate: plan.totalEstimate
});
r4.status === "failed" && r4.errors.some((e: string) => e.includes("HTML-like"))
  ? ok("HTML-like item content fails")
  : no(`HTML-like content not caught: ${r4.errors.join("; ")}`);

const listingId = "11111111-1111-4111-8111-111111111111";
const r5 = verifyTripPlan({
  destination: baseInput.destination,
  startDate: baseInput.startDate,
  endDate: baseInput.endDate,
  pace: baseInput.profile.pace,
  days: plan.days,
  items: [{ ...plan.items[0], stayListingId: listingId }],
  allowedStayListingIds: ["22222222-2222-4222-8222-222222222222"],
  totalEstimate: plan.totalEstimate
});
r5.status === "failed" && r5.errors.some((e: string) => e.includes("not approved"))
  ? ok("unapproved stay listing id fails")
  : no(`unapproved stay not caught: ${r5.errors.join("; ")}`);

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
