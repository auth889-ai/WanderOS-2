/**
 * P2 integration test — queue + worker (real Upstash Redis + real Aurora).
 *   Run: npm run test:queue
 * Proves the async backbone end-to-end with a DUMMY handler (the real studio crew plugs in at P3):
 *   enqueue → worker claims → progress → succeeded · idempotent re-enqueue · cooperative cancel.
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
const { getJob, requestCancel } = await import("../../lib/db/tables/agent-jobs");
const { enqueueJob, QUEUE_NAMES, closeQueues } = await import("../../lib/queue/queues");
const { redisConnectionOptions } = await import("../../lib/queue/connection");
const { runJob } = await import("../../lib/queue/runner");
import type { JobHandler } from "../../lib/queue/runner";
import type { AgentJobRow } from "../../lib/db/tables/agent-jobs";

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── P2: queue + worker (Upstash + Aurora) ──\n");

// DUMMY handler — exercises progress + cancel; the real studio crew replaces it in P3.
const handler: JobHandler = async (ctx) => {
  await ctx.reportProgress(20, "stage-a");
  await ctx.throwIfCancelled();
  if ((ctx.input as { slow?: boolean }).slow) {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 300));
      await ctx.throwIfCancelled(); // host cancel lands here
      await ctx.reportProgress(Math.min(90, 20 + i * 2), "slow-loop");
    }
  }
  await ctx.reportProgress(80, "stage-b");
  return { ok: true, echoed: ctx.input };
};

const worker = new Worker(
  QUEUE_NAMES.studio,
  async (job) => {
    const agentJobId = job.data.agentJobId as string;
    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await runJob({ agentJobId, isLastAttempt, handler });
  },
  { connection: redisConnectionOptions(), concurrency: 2, lockDuration: 600000 }
);

async function waitFor(jobId: string, pred: (j: AgentJobRow) => boolean, timeoutMs = 25000): Promise<AgentJobRow | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const j = await getJob(jobId);
    if (j && pred(j)) return j;
    await new Promise((r) => setTimeout(r, 500));
  }
  return getJob(jobId);
}

const created: string[] = [];

try {
  await worker.waitUntilReady();
  ok("worker connected to Upstash + ready");

  // 1 — happy path: enqueue → runs → succeeded
  const key1 = `p2-ok-${randomUUID()}`;
  const r1 = await enqueueJob({ type: "studio", idempotencyKey: key1, input: { hello: "world" } });
  created.push(r1.id);
  r1.status === "queued" ? ok(`enqueued (queued, ${r1.id.slice(0, 8)})`) : no(`status=${r1.status}`);

  const done = await waitFor(r1.id, (j) => j.status === "succeeded" || j.status === "failed");
  done?.status === "succeeded" ? ok("worker ran it → succeeded") : no(`ended ${done?.status} (${done?.error ?? ""})`);
  done?.progress === 100 ? ok("progress reached 100%") : no(`progress=${done?.progress}`);
  (done?.output as { ok?: boolean })?.ok === true ? ok("handler output persisted to agent_jobs") : no("output missing");

  // 2 — idempotency: same key → same row
  const r1dup = await enqueueJob({ type: "studio", idempotencyKey: key1, input: { hello: "world" } });
  r1dup.id === r1.id ? ok("IDEMPOTENT — re-enqueue with same key returned the same job") : no(`new job ${r1dup.id}`);

  // 3 — cooperative cancel: a slow job, cancelled mid-run
  const key2 = `p2-cancel-${randomUUID()}`;
  const r2 = await enqueueJob({ type: "studio", idempotencyKey: key2, input: { slow: true } });
  created.push(r2.id);
  const running = await waitFor(r2.id, (j) => j.status === "running", 10000);
  running?.status === "running" ? ok("slow job picked up (running)") : no(`status=${running?.status}`);

  await requestCancel(r2.id);
  const cancelled = await waitFor(r2.id, (j) => j.status === "cancelled", 15000);
  cancelled?.status === "cancelled" ? ok("host cancel honored → cancelled mid-run") : no(`ended ${cancelled?.status}`);
} finally {
  await worker.close();
  await closeQueues();
  if (created.length) await queryAurora(`delete from agent_jobs where id = any($1::uuid[])`, [created]);
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
