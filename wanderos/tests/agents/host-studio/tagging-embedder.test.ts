/**
 * Agent test — tagging-embedder (host-studio crew). Action-taking: it WRITES to pgvector.
 *   Run: npm run test:agent:tagging
 * Asserts tags are produced AND the embedding is written AND it's retrievable by semantic search
 * (proving the listing joined WanderOS's RAG memory).
 */
import { readFileSync } from "fs";

for (const line of readFileSync(new URL("../../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("//") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { queryAurora } = await import("../../../lib/db/pool");
const { taggingEmbedder } = await import("../../../lib/agents/crews/host-studio/agents/tagging-embedder/agent");
const { retrieve } = await import("../../../lib/agents/tools/pgvector-retriever.tool");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── agent: tagging-embedder (writes to pgvector) ──\n");

const host = (await queryAurora<{ id: string }>("select id from users where role='host' limit 1"))[0];
if (!host) throw new Error("seed a host first: npm run seed:demo");

const seeded = await queryAurora<{ id: string }>(
  `insert into listings (host_id,title,description,city,country,category,price,status,moderation_status,quality_score)
   values ($1,'TAGTEST Lakeside Cabin','A secluded lakeside cabin with a wood-fired sauna and canoe.','Pokhara','Nepal','cabin',5000,'published','approved',88)
   returning id`,
  [host.id]
);
const listingId = seeded[0].id;

let embeddingId: string | undefined;
try {
  const result = await taggingEmbedder({
    listingId,
    category: "cabin",
    city: "Pokhara",
    country: "Nepal",
    title: "TAGTEST Lakeside Cabin",
    description: "A secluded lakeside cabin with a wood-fired sauna and a canoe.",
    amenities: ["sauna", "lake access", "canoe", "fireplace"]
  });
  embeddingId = result.embeddingId;
  console.log("Result:", JSON.stringify(result, null, 2), "\n");

  result.tags.length >= 5 ? ok("produced 5+ discovery tags") : no(`tags=${result.tags.length}`);
  result.vibes.length > 0 ? ok("produced vibe tags") : no("no vibes");
  result.searchKeywords.length > 0 ? ok("produced search keywords") : no("no keywords");
  result.embedded === true ? ok("wrote the embedding (action)") : no("did not embed");
  embeddingId ? ok("got an embedding id back") : no("no embedding id");

  // verify the embedding is retrievable by semantic search (RAG loop closed)
  const hits = await retrieve({ query: "lakeside cabin with a sauna and canoe", ownerTypes: ["listing"], limit: 5 });
  hits.some((h) => h.id === embeddingId)
    ? ok("embedding is RETRIEVABLE by semantic search (joined WanderOS memory)")
    : no("embedding not found by retrieval");
} finally {
  if (embeddingId) await queryAurora("delete from embeddings where id = $1", [embeddingId]);
  await queryAurora("delete from listings where id = $1", [listingId]);
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
