/**
 * P3 e2e — the REAL Host Studio crew running as a worker job (real Upstash + Aurora + LLMs).
 *   Run: npm run test:studio:job
 * Proves: enqueue a studio job → the worker runs the 10-node crew → live progress advances through
 * the agents → job ends 'succeeded' with the premium draft + details in agent_jobs.output.
 * Uses 1 photo + attempts:1 to keep cost/time down (it's a full crew run, ~2-3 min).
 */
import { readFileSync } from "fs";
import { randomUUID } from "crypto";

for (const line of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("#") || line.trim().startsWith("//")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { Worker } = await import("bullmq");
const { queryAurora } = await import("../../lib/db/pool");
const { getJob } = await import("../../lib/db/tables/agent-jobs");
const { getById } = await import("../../lib/db/tables/listings");
const { listVersions } = await import("../../lib/db/tables/listing-versions");
const { enqueueJob, QUEUE_NAMES, closeQueues } = await import("../../lib/queue/queues");
const { redisConnectionOptions } = await import("../../lib/queue/connection");
const { runJob } = await import("../../lib/queue/runner");
const { JOB_HANDLERS } = await import("../../worker/handlers");
import type { AgentJobRow } from "../../lib/db/tables/agent-jobs";

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── P3: Host Studio crew AS A WORKER JOB ──\n");

// temp host + listing (FK target for agent_jobs.listing_id + the crew's embedding owner_id)
const [host] = await queryAurora<{ id: string }>(
  `insert into users (name, email, role) values ('P3 Host', $1, 'host') returning id`,
  [`p3-${randomUUID()}@test.local`]
);
const [listing] = await queryAurora<{ id: string }>(
  `insert into listings (host_id, title, description, city, country, category)
   values ($1, 'P3 draft', 'draft', 'Dubai', 'United Arab Emirates', 'apartment') returning id`,
  [host.id]
);

// one real photo
const photo = `data:image/png;base64,${readFileSync(new URL("../../test_photos/image.png", import.meta.url)).toString("base64")}`;

const studioHandler = JOB_HANDLERS.studio!;
const worker = new Worker(
  QUEUE_NAMES.studio,
  async (job) => {
    const agentJobId = job.data.agentJobId as string;
    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await runJob({ agentJobId, isLastAttempt, handler: studioHandler });
  },
  { connection: redisConnectionOptions(), concurrency: 1, lockDuration: 600000 }
);

const stagesSeen = new Set<string>();
async function waitFor(jobId: string, pred: (j: AgentJobRow) => boolean, timeoutMs: number): Promise<AgentJobRow | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const j = await getJob(jobId);
    if (j?.current_stage) stagesSeen.add(j.current_stage);
    if (j && pred(j)) return j;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return getJob(jobId);
}

try {
  await worker.waitUntilReady();
  ok("worker ready");

  const studioInput = {
    userId: host.id,
    listingId: listing.id,
    category: "apartment",
    city: "Dubai",
    country: "United Arab Emirates",
    notes: "Modern apartment with skyline views, floor-to-ceiling windows, AC, designer bathroom. No smoking.",
    photos: [photo]
  };

  const job = await enqueueJob({
    type: "studio",
    listingId: listing.id,
    userId: host.id,
    idempotencyKey: `studio:${listing.id}`,
    input: studioInput,
    attempts: 1
  });
  ok(`enqueued studio job ${job.id.slice(0, 8)}`);

  const done = await waitFor(job.id, (j) => j.status === "succeeded" || j.status === "failed", 300000);
  done?.status === "succeeded" ? ok(`crew ran on the worker → succeeded`) : no(`ended '${done?.status}': ${done?.error ?? ""}`);
  done?.progress === 100 ? ok("progress reached 100%") : no(`progress=${done?.progress}`);
  stagesSeen.size >= 3 ? ok(`live progress advanced through stages (${[...stagesSeen].slice(0, 4).join(" → ")} …)`) : no(`only saw stages: ${[...stagesSeen].join(", ")}`);

  const out = done?.output as { draft?: { title?: string; price?: number }; details?: { roomBreakdown?: unknown[] }; runId?: string } | undefined;
  out?.draft?.title ? ok(`draft in job output: "${out.draft.title}" (${out.draft.price})`) : no("no draft in output");
  out?.details?.roomBreakdown && out.details.roomBreakdown.length > 0 ? ok(`premium details in job output (${out.details.roomBreakdown.length} rooms)`) : no("no details in output");
  out?.runId ? ok(`linked to agent_run ${out.runId.slice(0, 8)} (full trace)`) : no("no runId");

  // ── THE WIRED PATH (P4): applyStudioDraft wrote the crew draft INTO the listings row + snapshotted v1 ──
  const row = await getById(listing.id);
  row && row.title === out?.draft?.title && row.title !== "P3 draft"
    ? ok(`listings ROW updated with the AI draft ("${row.title}", was "P3 draft")`)
    : no(`listings row not updated (title=${row?.title})`);
  row && Number(row.price) === out?.draft?.price ? ok("listings row price set from the draft") : no(`row price=${row?.price}`);
  (row?.details as { roomBreakdown?: unknown[] })?.roomBreakdown?.length ? ok("premium details persisted on the listings ROW") : no("details not on the row");
  const versions = await listVersions(listing.id);
  versions.length >= 1 ? ok(`listing_versions v${versions[0].version} snapshot created (note: "${versions[0].note}")`) : no("no version snapshot");
} finally {
  await worker.close();
  await closeQueues();
  await queryAurora(`delete from embeddings where owner_id = $1`, [listing.id]);
  await queryAurora(`delete from listings where id = $1`, [listing.id]); // cascades the agent_job
  await queryAurora(`delete from agent_runs where user_id = $1`, [host.id]); // cascades agent_steps; FK before user
  await queryAurora(`delete from users where id = $1`, [host.id]);
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
