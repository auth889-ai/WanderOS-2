/**
 * P1 repo test — agent_jobs + listing_versions (the job foundation).
 *   Run: npm run test:db:jobs
 * Proves: idempotent job creation, the job lifecycle (running→progress→succeeded), cancel, and
 * versioned listing snapshots — all against real Aurora. Creates a temp host+listing for the FKs.
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
const jobs = await import("../../lib/db/tables/agent-jobs");
const versions = await import("../../lib/db/tables/listing-versions");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── P1: agent_jobs + listing_versions ──\n");

// temp host + listing for the FKs
const email = `p1-${randomUUID()}@test.local`;
const [host] = await queryAurora<{ id: string }>(
  `insert into users (name, email, role) values ('P1 Host', $1, 'host') returning id`,
  [email]
);
const [listing] = await queryAurora<{ id: string }>(
  `insert into listings (host_id, title, description, city, country, category)
   values ($1, 'P1 Test Listing', 'desc', 'Dubai', 'UAE', 'apartment') returning id`,
  [host.id]
);

try {
  // ── agent_jobs ──
  const key = `studio:${listing.id}`;
  const j1 = await jobs.createJob({ type: "studio", listingId: listing.id, userId: host.id, idempotencyKey: key, input: { city: "Dubai" } });
  j1.status === "queued" && j1.progress === 0 ? ok(`created job (queued, id ${j1.id.slice(0, 8)})`) : no(`status=${j1.status} progress=${j1.progress}`);

  const j1dup = await jobs.createJob({ type: "studio", listingId: listing.id, userId: host.id, idempotencyKey: key, input: { city: "Dubai" } });
  j1dup.id === j1.id ? ok("IDEMPOTENT — duplicate submit returned the same job") : no(`duplicate created a new job (${j1dup.id})`);

  const running = await jobs.markRunning(j1.id, null);
  running?.status === "running" && running.attempts === 1 ? ok("markRunning → running, attempts=1") : no(`status=${running?.status} attempts=${running?.attempts}`);

  await jobs.updateProgress(j1.id, 40, "property-vision");
  const mid = await jobs.getJob(j1.id);
  mid?.progress === 40 && mid.current_stage === "property-vision" ? ok("updateProgress → 40% @ property-vision") : no(`progress=${mid?.progress} stage=${mid?.current_stage}`);

  const done = await jobs.markSucceeded(j1.id, { draftId: listing.id });
  done?.status === "succeeded" && done.progress === 100 ? ok("markSucceeded → succeeded, 100%") : no(`status=${done?.status} progress=${done?.progress}`);

  const byKey = await jobs.getJobByKey(key);
  byKey?.id === j1.id ? ok("getJobByKey resolves the job") : no("getJobByKey failed");

  // a second job we cancel
  const j2 = await jobs.createJob({ type: "listing_video", listingId: listing.id, userId: host.id, idempotencyKey: `video:${listing.id}`, input: {} });
  const cancelReq = await jobs.requestCancel(j2.id);
  cancelReq?.cancel_requested === true ? ok("requestCancel → cancel_requested=true") : no("cancel flag not set");
  const cancelled = await jobs.markCancelled(j2.id);
  cancelled?.status === "cancelled" ? ok("markCancelled → cancelled") : no(`status=${cancelled?.status}`);

  const list = await jobs.listJobsForListing(listing.id);
  list.length === 2 ? ok(`listJobsForListing → ${list.length} jobs`) : no(`expected 2, got ${list.length}`);

  // ── listing_versions ──
  const v1 = await versions.saveVersion({ listingId: listing.id, snapshot: { title: "v1 title", price: 100 }, editedBy: host.id, note: "first draft" });
  v1.version === 1 ? ok("saveVersion → version 1") : no(`version=${v1.version}`);
  const v2 = await versions.saveVersion({ listingId: listing.id, snapshot: { title: "v2 title", price: 120 }, editedBy: host.id, note: "host edit" });
  v2.version === 2 ? ok("saveVersion → version 2 (auto-incremented)") : no(`version=${v2.version}`);

  const all = await versions.listVersions(listing.id);
  all.length === 2 && all[0].version === 2 ? ok("listVersions → 2, newest first") : no(`got ${all.length}, first v=${all[0]?.version}`);
  const got = await versions.getVersion(listing.id, 1);
  (got?.snapshot as { title?: string })?.title === "v1 title" ? ok("getVersion(1) returns the right snapshot") : no("getVersion snapshot wrong");
} finally {
  await queryAurora(`delete from listings where id = $1`, [listing.id]); // cascades jobs + versions
  await queryAurora(`delete from users where id = $1`, [host.id]);
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
