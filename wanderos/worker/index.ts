/**
 * The WORKER process (Plane B) — runs heavy crews off the Vercel request path.
 * Launch: `npm run worker` (a standalone Node process; never runs on Vercel).
 * For each registered job type it starts a BullMQ Worker that claims jobs and drives them through
 * the generic runner. Tuned for AI workloads: long lock (crews take minutes), capped concurrency
 * (don't blast the LLM providers / budget), graceful shutdown (drain in-flight on deploy/restart).
 */
import { readFileSync } from "fs";

// load .env.local (worker runs standalone, not via Next)
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    if (!line.includes("=") || line.trim().startsWith("#") || line.trim().startsWith("//")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
} catch {
  /* in prod, env comes from the host (Render/Railway) — no .env.local file */
}

const { Worker } = await import("bullmq");
const { redisConnectionOptions } = await import("@/lib/queue/connection");
const { QUEUE_NAMES, closeQueues } = await import("@/lib/queue/queues");
const { runJob } = await import("@/lib/queue/runner");
const { JOB_HANDLERS } = await import("./handlers");
import type { Worker as WorkerType } from "bullmq";
import type { JobType } from "@/lib/db/tables/agent-jobs";

const LOCK_DURATION = 10 * 60 * 1000; // 10 min — AI crews run minutes; default 30s would falsely "stall" them
const CONCURRENCY = 2; // cap parallel crews → respect LLM rate limits + cost

const workers: WorkerType[] = [];

for (const [type, handler] of Object.entries(JOB_HANDLERS) as [JobType, (typeof JOB_HANDLERS)[JobType]][]) {
  if (!handler) continue;
  const w = new Worker(
    QUEUE_NAMES[type],
    async (job, token) => {
      const agentJobId = job.data.agentJobId as string;
      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await runJob({
        agentJobId,
        isLastAttempt,
        handler,
        extendLock: token
          ? async () => {
              await job.extendLock(token, LOCK_DURATION);
            }
          : undefined
      });
    },
    // drainDelay (s) = idle blocking-poll timeout; stalledInterval (ms) = stalled-job scan.
    // Raised well above defaults (5s / 30s) to slash idle Redis requests — jobs still wake the worker instantly, so no latency cost.
    { connection: redisConnectionOptions(), concurrency: CONCURRENCY, lockDuration: LOCK_DURATION, drainDelay: 60, stalledInterval: 300_000 }
  );
  w.on("completed", (job) => console.log(`[worker:${type}] ✅ job ${job.id}`));
  w.on("failed", (job, err) => console.error(`[worker:${type}] ❌ job ${job?.id}: ${err?.message}`));
  workers.push(w);
  console.log(`[worker] listening on "${QUEUE_NAMES[type]}" (concurrency ${CONCURRENCY}, lock ${LOCK_DURATION / 1000}s)`);
}

if (workers.length === 0) {
  console.log("[worker] no handlers registered yet (studio wired in P3, video in P10). Idle.");
}

async function shutdown(signal: string) {
  console.log(`\n[worker] ${signal} — draining in-flight jobs...`);
  await Promise.all(workers.map((w) => w.close()));
  await closeQueues();
  console.log("[worker] shut down cleanly.");
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
