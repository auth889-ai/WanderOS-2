/**
 * Agent test - trip-planner stay-matcher.
 *   Run: npm run test:agent:trip-stay-matcher
 *
 * Proves the stay-matcher is grounded:
 * pgvector retrieves listing memory, then Aurora hard filters approval, destination, capacity, and budget.
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
const { remember } = await import("../../../lib/agents/tools/pgvector-retriever.tool");
const { matchStays } = await import("../../../lib/agents/crews/trip-planner/agents/stay-matcher/agent");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── agent: trip-planner stay-matcher (pgvector + Aurora) ──\n");

const [host] = await queryAurora<{ id: string }>(
  `insert into users (name, email, role)
   values ('Stay Matcher Host', $1, 'host')
   returning id`,
  [`stay-matcher-host-${randomUUID()}@test.local`]
);

const listingIds: string[] = [];
const embeddingIds: string[] = [];

async function seedListing(input: {
  title: string;
  city: string;
  country: string;
  price: number;
  maxGuests: number;
  moderationStatus: string;
  tags: string[];
  amenities: string[];
}) {
  const [listing] = await queryAurora<{ id: string }>(
    `insert into listings
       (host_id,title,description,city,country,category,price,max_guests,amenities,tags,status,moderation_status,quality_score)
     values
       ($1,$2,$3,$4,$5,'boutique-stay',$6,$7,$8,$9,'published',$10,91)
     returning id`,
    [
      host.id,
      input.title,
      `${input.title} for food, culture, museums, quiet evenings, and transit-friendly city exploration.`,
      input.city,
      input.country,
      input.price,
      input.maxGuests,
      input.amenities,
      input.tags,
      input.moderationStatus
    ]
  );
  listingIds.push(listing.id);

  const embedding = await remember({
    ownerType: "listing",
    ownerId: listing.id,
    content: `${input.title}. ${input.city}, ${input.country}. Food culture museums couple stay ${input.tags.join(" ")} ${input.amenities.join(" ")}.`,
    metadata: { city: input.city, country: input.country, _test: "stay-matcher" }
  });
  if (embedding?.id) embeddingIds.push(embedding.id);

  return listing.id;
}

const approvedTokyo = await seedListing({
  title: "STAYMATCH Tokyo Food Culture Loft",
  city: "Tokyo",
  country: "Japan",
  price: 180,
  maxGuests: 2,
  moderationStatus: "approved",
  tags: ["food", "culture", "museum", "couple"],
  amenities: ["metro access", "kitchenette", "quiet room"]
});

const smallTokyo = await seedListing({
  title: "STAYMATCH Tiny Tokyo Solo Pod",
  city: "Tokyo",
  country: "Japan",
  price: 90,
  maxGuests: 1,
  moderationStatus: "approved",
  tags: ["budget", "solo"],
  amenities: ["shared bath"]
});

const pendingTokyo = await seedListing({
  title: "STAYMATCH Pending Tokyo Suite",
  city: "Tokyo",
  country: "Japan",
  price: 160,
  maxGuests: 2,
  moderationStatus: "pending_review",
  tags: ["food", "culture"],
  amenities: ["metro access"]
});

const kyoto = await seedListing({
  title: "STAYMATCH Kyoto Heritage House",
  city: "Kyoto",
  country: "Japan",
  price: 170,
  maxGuests: 2,
  moderationStatus: "approved",
  tags: ["culture", "temple"],
  amenities: ["garden"]
});

try {
  const result = await matchStays({
    brief: {
      destination: "Tokyo",
      startDate: "2026-07-10",
      endDate: "2026-07-13",
      budget: 1600,
      travelStyle: "food, culture, museums",
      interests: ["food", "culture", "museums"],
      party: "couple",
      pace: "balanced",
      constraints: {}
    },
    profile: {
      party: "couple",
      travelerCount: 2,
      budget: 1600,
      budgetBand: "midrange",
      pace: "balanced",
      interests: ["food", "culture", "museums"],
      constraints: {},
      travelStyle: "food, culture, museums",
      query: "Tokyo couple food culture museums midrange stay metro quiet",
      reasoning: "Normalized test profile."
    },
    destinationIntel: {
      destination: "Tokyo",
      neighborhoods: ["Asakusa", "Ueno", "Shinjuku"],
      themes: ["food neighborhoods", "museum mornings", "evening walks"],
      anchors: [],
      seasonalityNotes: ["Summer humidity requires pacing."],
      warnings: ["Book popular restaurants early."]
    }
  });

  console.log("StayMatcherResult:", JSON.stringify(result, null, 2), "\n");

  result.recommendations.length >= 1 ? ok("returned at least one recommendation") : no("no recommendations");
  result.recommendations.some((rec: { listingId: string }) => rec.listingId === approvedTokyo)
    ? ok("recommended the approved Tokyo listing")
    : no("approved Tokyo listing missing");
  result.recommendations.every((rec: { listingId: string }) => rec.listingId !== smallTokyo)
    ? ok("capacity filter excluded one-guest listing")
    : no("one-guest listing leaked");
  result.recommendations.every((rec: { listingId: string }) => rec.listingId !== pendingTokyo)
    ? ok("approval filter excluded pending listing")
    : no("pending listing leaked");
  result.recommendations.every((rec: { listingId: string }) => rec.listingId !== kyoto)
    ? ok("destination filter excluded other city")
    : no("other city listing leaked");
  result.recommendations.every((rec: { hardFiltersPassed: boolean }) => rec.hardFiltersPassed)
    ? ok("all recommendations passed hard filters")
    : no("hardFiltersPassed false");
  result.recommendations.every((rec: { why?: string }) => Boolean(rec.why && rec.why.length >= 8))
    ? ok("all recommendations include reasons")
    : no("missing recommendation reason");
  result.retrieval.retrievedCount > 0 ? ok("pgvector retrieval returned hits") : no("no pgvector hits");
  result.retrieval.candidateCount >= 1 ? ok("Aurora produced filtered candidates") : no("no filtered candidates");
} finally {
  if (embeddingIds.length) await queryAurora(`delete from embeddings where id = any($1::uuid[])`, [embeddingIds]).catch(() => {});
  if (listingIds.length) await queryAurora(`delete from listings where id = any($1::uuid[])`, [listingIds]).catch(() => {});
  await queryAurora(`delete from users where id = $1`, [host.id]).catch(() => {});
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
