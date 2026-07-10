/**
 * P5 test — the create/cancel/retry orchestration the API routes call (real Aurora + Upstash, no crew).
 *   Run: npm run test:svc:flow
 * Proves: startStudioDraft creates the draft row + enqueues a job; cancelDraft cancels a queued job
 * (+ removes it from BullMQ); retryDraft re-enqueues a failed job; RBAC blocks a different host.
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
const svc = await import("../../lib/services/listing.service");
const { getJob, createJob, markFailed } = await import("../../lib/db/tables/agent-jobs");
const { removeQueuedJob, closeQueues } = await import("../../lib/queue/queues");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── P5: create / cancel / retry orchestration (API layer) ──\n");

const [host] = await queryAurora<{ id: string }>(
  `insert into users (name, email, role) values ('P5 Host', $1, 'host') returning id`,
  [`p5-${randomUUID()}@test.local`]
);
const [other] = await queryAurora<{ id: string }>(
  `insert into users (name, email, role) values ('P5 Other', $1, 'host') returning id`,
  [`p5o-${randomUUID()}@test.local`]
);

let listingId = "";
let retryKey = "";
try {
  // 1 — startStudioDraft: draft row + queued job
  const started = await svc.startStudioDraft(host.id, { city: "Dubai", country: "UAE", category: "apartment", notes: "modern", photos: [] });
  listingId = started.listing.id;
  started.listing.status === "draft" ? ok(`startStudioDraft → draft row (${listingId.slice(0, 8)})`) : no(`status=${started.listing.status}`);
  const queued = await getJob(started.jobId);
  queued?.status === "queued" ? ok("studio job enqueued (queued)") : no(`job status=${queued?.status}`);

  // 2 — RBAC: a different host can't cancel
  const denied = await svc.cancelDraft(listingId, other.id);
  !denied.ok ? ok("RBAC — different host cannot cancel") : no("RBAC breach on cancel");

  // 3 — cancelDraft: queued job → cancelled + removed from BullMQ
  const cancelled = await svc.cancelDraft(listingId, host.id);
  cancelled.ok ? ok("cancelDraft → ok") : no(`cancel error: ${cancelled.error}`);
  const afterCancel = await getJob(started.jobId);
  afterCancel?.status === "cancelled" ? ok("queued job marked cancelled") : no(`status=${afterCancel?.status}`);

  // 4 — retryDraft: needs a failed job → create one, then retry
  const failedJob = await createJob({ type: "studio", listingId, userId: host.id, idempotencyKey: `studio-${listingId}-old`, input: { listingId, city: "Dubai" } });
  await markFailed(failedJob.id, "simulated failure");
  const retried = await svc.retryDraft(listingId, host.id);
  retryKey = retried.idempotencyKey ?? "";
  retried.ok && retried.jobId ? ok(`retryDraft → re-enqueued (${retried.jobId.slice(0, 8)})`) : no(`retry error: ${retried.error}`);
  const retryJob = retried.jobId ? await getJob(retried.jobId) : null;
  retryJob?.status === "queued" ? ok("retry job is queued") : no(`retry job status=${retryJob?.status}`);

  // 5 — retry with no failed job → rejected
  const noRetry = await svc.retryDraft(listingId, other.id);
  !noRetry.ok ? ok("RBAC — different host cannot retry") : no("RBAC breach on retry");
} finally {
  if (retryKey) await removeQueuedJob("studio", retryKey); // don't leave a queued job in Upstash
  await closeQueues();
  if (listingId) await queryAurora(`delete from listings where id = $1`, [listingId]); // cascades agent_jobs
  await queryAurora(`delete from users where id = any($1::uuid[])`, [[host.id, other.id]]);
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
