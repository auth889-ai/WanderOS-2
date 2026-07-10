/**
 * S6 service test - pgvector-personalized For You feed.
 *   Run: npm run test:svc:feed-ranking
 */
import { readFileSync } from "fs";
import { randomUUID } from "crypto";

for (const line of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("#") || line.trim().startsWith("//")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { queryAurora } = await import("../../lib/db/pool");
const postService = await import("../../lib/services/post.service");
const feedService = await import("../../lib/services/feed.service");
const { remember } = await import("../../lib/agents/tools/pgvector-retriever.tool");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── S6: pgvector-personalized feed ranking ──\n");

async function createTraveler(label: string) {
  const [user] = await queryAurora<{ id: string }>(
    `insert into users (name, email, role) values ($1,$2,'traveler') returning id`,
    [`S6 ${label}`, `s6-${label}-${randomUUID()}@test.local`]
  );
  return user;
}

const author = await createTraveler("author");
const viewer = await createTraveler("viewer");

let relevantPostId = "";
let unrelatedPostId = "";
let tripId = "";

try {
  const relevant = await postService.createDraftPost(author.id, {
    title: "S6 Kyoto saffron-river ramen market walk",
    caption: "A kintsugi food crawl through Kyoto ramen alleys, quiet markets, and night walks.",
    destination: "Kyoto",
    location: "Nishiki Market",
    mood: "slow food culture",
    tags: ["kyoto", "ramen", "kintsugi", "saffron-river", "markets"]
  });
  relevantPostId = relevant.post.id;
  await postService.publishPost(author.id, relevantPostId);

  const unrelated = await postService.createDraftPost(author.id, {
    title: "S6 Arctic snowboard ridge",
    caption: "A high-adrenaline snowboarding day with icy ridges and alpine jumps.",
    destination: "Reykjavik",
    location: "Snow ridge",
    mood: "adrenaline",
    tags: ["snowboarding", "arctic", "alpine"]
  });
  unrelatedPostId = unrelated.post.id;
  await postService.publishPost(author.id, unrelatedPostId);

  const relevantEmbedding = await remember({
    ownerType: "post",
    ownerId: relevantPostId,
    content: "Kyoto saffron-river ramen kintsugi market walk quiet food culture night streets Nishiki",
    metadata: { userId: author.id, postId: relevantPostId, destination: "Kyoto", verifiedStay: false, _test: "s6-feed" }
  });
  const unrelatedEmbedding = await remember({
    ownerType: "post",
    ownerId: unrelatedPostId,
    content: "Arctic snowboard ridge icy alpine jumps extreme winter sports adrenaline",
    metadata: { userId: author.id, postId: unrelatedPostId, destination: "Reykjavik", verifiedStay: false, _test: "s6-feed" }
  });

  relevantEmbedding?.id ? ok("relevant post embedded") : no("relevant embedding missing");
  unrelatedEmbedding?.id ? ok("unrelated post embedded") : no("unrelated embedding missing");

  const [trip] = await queryAurora<{ id: string }>(
    `insert into trips (traveler_id, title, destination, start_date, end_date, budget, travel_style, status, profile)
     values ($1, 'S6 Kyoto food trip', 'Kyoto', '2026-10-01', '2026-10-05', 1600, 'food, culture, night walks', 'ready', $2::jsonb)
     returning id`,
    [
      viewer.id,
      JSON.stringify({
        interests: ["saffron-river ramen", "kintsugi markets", "quiet Kyoto food culture"],
        pace: "balanced",
        party: "couple"
      })
    ]
  );
  tripId = trip.id;

  const feed = await feedService.getFeed({ viewerId: viewer.id, tab: "for-you", limit: 50 });
  const relevantIndex = feed.findIndex((post) => post.id === relevantPostId);
  const unrelatedIndex = feed.findIndex((post) => post.id === unrelatedPostId);

  relevantIndex >= 0 ? ok("relevant post appears in For You") : no("relevant post missing");
  unrelatedIndex >= 0 ? ok("unrelated post appears in ranked candidate set") : no("unrelated post missing");
  relevantIndex >= 0 && unrelatedIndex >= 0 && relevantIndex < unrelatedIndex
    ? ok("pgvector relevance ranks Kyoto food post above unrelated snowboard post")
    : no(`ranking wrong: relevant=${relevantIndex}, unrelated=${unrelatedIndex}`);

  const rankedRelevant = feed.find((post) => post.id === relevantPostId);
  const rankedUnrelated = feed.find((post) => post.id === unrelatedPostId);
  Number(rankedRelevant?.semantic_score ?? 0) > Number(rankedUnrelated?.semantic_score ?? -1)
    ? ok("semantic_score is higher for matching post")
    : no(`semantic scores relevant=${rankedRelevant?.semantic_score}, unrelated=${rankedUnrelated?.semantic_score}`);
  Number(rankedRelevant?.ranking_score ?? 0) > 0 ? ok("ranking_score returned from Aurora read model") : no("ranking_score missing");
} finally {
  await queryAurora(`delete from embeddings where owner_type = 'post' and owner_id = any($1::uuid[])`, [[relevantPostId, unrelatedPostId].filter(Boolean)]).catch(() => {});
  await queryAurora(`delete from travel_posts where id = any($1::uuid[])`, [[relevantPostId, unrelatedPostId].filter(Boolean)]).catch(() => {});
  if (tripId) await queryAurora(`delete from trips where id = $1`, [tripId]).catch(() => {});
  await queryAurora(`delete from users where id = any($1::uuid[])`, [[author.id, viewer.id]]).catch(() => {});
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
