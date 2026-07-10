/**
 * Agent test - trip-planner deterministic composer. No LLM, no DB.
 *   Run: npm run test:agent:trip-composer
 *
 * Proves the final commit boundary assembles agent outputs into verified Aurora-ready rows.
 */
export {};

const { composeTripPlan } = await import("../../../lib/agents/crews/trip-planner/composer");
const { verifyTripPlan } = await import("../../../lib/agents/crews/trip-planner/verifier");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── agent: trip-planner deterministic composer ──\n");

const stayId = "11111111-1111-4111-8111-111111111111";
const input = {
  brief: {
    destination: "Tokyo",
    startDate: "2026-07-10",
    endDate: "2026-07-11",
    budget: 1300,
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
    budget: 1300,
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
  destinationIntel: {
    destination: "Tokyo",
    seasonalityNotes: ["July is humid; use indoor cultural anchors in the afternoon."],
    neighborhoods: ["Asakusa", "Ueno"],
    themes: ["arrival food walk", "museum and skyline"],
    anchors: [
      { name: "Senso-ji market streets", area: "Asakusa", category: "culture", why: "Arrival-friendly cultural anchor." }
    ],
    warnings: ["Keep a rain backup for outdoor photo walks."]
  },
  stayRecommendations: [
    {
      listingId: stayId,
      title: "Tokyo Food Culture Loft",
      area: "Ueno",
      pricePerNight: 180,
      currency: "USD",
      maxGuests: 2,
      matchScore: 0.91,
      why: "Approved WanderOS listing near food and culture anchors.",
      source: "pgvector",
      hardFiltersPassed: true
    }
  ],
  dayArchitecture: {
    days: [
      { dayNumber: 1, date: "2026-07-10", theme: "Arrival food walk", area: "Asakusa", energy: "low", targetItemCount: 3 },
      { dayNumber: 2, date: "2026-07-11", theme: "Museum and skyline", area: "Ueno", energy: "medium", targetItemCount: 3 }
    ],
    reasoning: "Balanced two-day plan."
  },
  items: [
    { dayNumber: 1, timeLabel: "Morning", title: "Senso-ji market streets", description: "Start with a low-pressure cultural walk.", category: "culture", source: "place-photo-enrichment", estCost: 0, locked: false, stayListingId: null, placeName: "Senso-ji", placeAddress: "Asakusa, Tokyo", placeUrl: "https://maps.google.com/?cid=1", externalPlaceId: "places/sensoji", placeRating: 4.6, imageUrl: "https://images.unsplash.com/photo-test", imageAttribution: { source: "unsplash" }, costSource: "google_places_price_level", costRationale: "Estimated from Google Places price level PRICE_LEVEL_FREE; not a live ticket or menu price.", metadata: { googlePriceLevel: "PRICE_LEVEL_FREE" } },
    { dayNumber: 1, timeLabel: "Lunch", title: "Nakamise snacks", description: "Keep food casual and allergy-aware.", category: "food", source: "place-photo-enrichment", estCost: 24, locked: false, stayListingId: null, costSource: "planner_estimate_unverified", costRationale: "No Google Places key or match was available, so this remains an unverified planning estimate." },
    { dayNumber: 1, timeLabel: "Evening", title: "Sumida night photo route", description: "Slow evening walk after check-in.", category: "photography", source: "place-photo-enrichment", estCost: 0, locked: false, stayListingId: null },
    { dayNumber: 2, timeLabel: "Morning", title: "Tokyo National Museum", description: "Culture anchor before lunch.", category: "museum", source: "place-photo-enrichment", estCost: 15, locked: false, stayListingId: null },
    { dayNumber: 2, timeLabel: "Lunch", title: "Ueno ramen lunch", description: "Pick a no-shellfish ramen option.", category: "food", source: "place-photo-enrichment", estCost: 18, locked: false, stayListingId: null },
    { dayNumber: 2, timeLabel: "Evening", title: "Skyline viewpoint", description: "End with a city view.", category: "viewpoint", source: "place-photo-enrichment", estCost: 20, locked: false, stayListingId: null }
  ],
  logisticsWarnings: ["Route order is a planning suggestion, not a live transit guarantee."],
  budgetPlan: {
    currency: "USD",
    totalEstimate: 329,
    budgetFit: "fit",
    allocations: [
      { category: "stay", amount: 180, reason: "One night approved WanderOS stay." },
      { category: "food", amount: 42, reason: "Food estimates from itinerary items." },
      { category: "activities", amount: 35, reason: "Paid activity estimates from itinerary items." },
      { category: "local transit", amount: 48, reason: "Two-day local transit buffer." }
    ],
    warnings: [],
    swapSuggestions: []
  },
  externalEnrichment: {
    places: { provider: "not_configured", status: "skipped" },
    routes: { provider: "not_configured", status: "skipped" },
    photos: { provider: "local", status: "available" }
  }
};

const plan = composeTripPlan(input);
const report = verifyTripPlan({
  destination: input.brief.destination,
  startDate: input.brief.startDate,
  endDate: input.brief.endDate,
  pace: input.profile.pace,
  budget: input.brief.budget,
  totalEstimate: plan.totalEstimate,
  days: plan.days,
  items: plan.items,
  allowedStayListingIds: [stayId]
});

console.log("ComposedPlan:", JSON.stringify(plan, null, 2), "\n");
console.log("VerifierReport:", JSON.stringify(report, null, 2), "\n");

plan.days.length === 2 ? ok("day count follows day architecture") : no(`days=${plan.days.length}`);
plan.items.length === 6 ? ok("item count follows logistics output") : no(`items=${plan.items.length}`);
plan.totalEstimate === 329 ? ok("total estimate comes from budget optimizer") : no(`total=${plan.totalEstimate}`);
plan.days[0].area === "Asakusa" ? ok("day area preserved for geo planning") : no(`area=${plan.days[0].area}`);
plan.items.every((item: { source: string }) => item.source === "composer") ? ok("composer owns persisted item source") : no("non-composer source persisted");
plan.items.every((item: { stayListingId?: string | null }) => !item.stayListingId) ? ok("composer does not invent stay item ids") : no("unexpected stay listing id on activity item");
plan.items[0].placeName === "Senso-ji" && plan.items[0].costSource === "google_places_price_level" ? ok("composer preserves external place/cost evidence") : no("external evidence missing from item");
plan.summary.includes("Tokyo") && plan.summary.includes("Recommended stay") ? ok("summary includes destination and grounded stay context") : no(`summary=${plan.summary}`);
JSON.stringify(plan.planningContext).includes("server-side enrichment only") ? ok("external API policy captured in planning context") : no("external API policy missing");
report.status === "passed" ? ok("composed plan passes deterministic verifier") : no(`verifier failed: ${report.errors.join("; ")}`);
report.warnings.some((warning: string) => warning.includes("differs from item total")) ? ok("verifier warns because total includes stay/transit beyond item costs") : no("expected total/item warning missing");
!/[<>]/.test(JSON.stringify(plan)) ? ok("no HTML-like text") : no("HTML-like text found");

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
