/**
 * Queue test - trip_plan worker premium crew path. No persisted fallback plan is allowed.
 *   Run: npm run test:queue:trip
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
const { enqueueJob, QUEUE_NAMES, closeQueues } = await import("../../lib/queue/queues");
const { redisConnectionOptions } = await import("../../lib/queue/connection");
const { runJob } = await import("../../lib/queue/runner");
const { JOB_HANDLERS } = await import("../../worker/handlers");
import type { AgentJobRow } from "../../lib/db/tables/agent-jobs";

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── queue: trip_plan worker premium crew ──\n");

const handler = JOB_HANDLERS.trip_plan;
if (!handler) throw new Error("trip_plan handler is not registered");

const worker = new Worker(
  QUEUE_NAMES.trip_plan,
  async (job) => {
    const agentJobId = job.data.agentJobId as string;
    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await runJob({ agentJobId, isLastAttempt, handler });
  },
  { connection: redisConnectionOptions(), concurrency: 1, lockDuration: 600000 }
);

async function waitFor(jobId: string, pred: (j: AgentJobRow) => boolean, timeoutMs = 180000): Promise<AgentJobRow | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const j = await getJob(jobId);
    if (j && pred(j)) return j;
    await new Promise((r) => setTimeout(r, 500));
  }
  return getJob(jobId);
}

let jobId = "";
let travelerId = "";
let tripId = "";

try {
  await worker.waitUntilReady();
  ok("trip_plan worker connected");

  const [traveler] = await queryAurora<{ id: string }>(
    `insert into users (name, email, role) values ('Trip Queue Traveler', $1, 'traveler') returning id`,
    [`trip-queue-${randomUUID()}@test.local`]
  );
  travelerId = traveler.id;
  const [trip] = await queryAurora<{ id: string }>(
    `insert into trips (traveler_id, title, destination, start_date, end_date, budget, travel_style, status, profile)
     values ($1, 'Trip Queue Tokyo', 'Tokyo', '2026-07-10', '2026-07-12', 1200, 'food-culture', 'planning', $2::jsonb)
     returning id`,
    [
      travelerId,
      JSON.stringify({
        party: "couple",
        pace: "balanced",
        interests: ["ramen", "museums"],
        constraints: { dietary: "no shellfish" },
        budget: 1200,
        travelStyle: "food-culture"
      })
    ]
  );
  tripId = trip.id;

  const job = await enqueueJob({
    type: "trip_plan",
    userId: travelerId,
    idempotencyKey: `trip-plan-test-${tripId}`,
    input: {
      tripId,
      travelerId,
      destination: "Tokyo",
      startDate: "2026-07-10",
      endDate: "2026-07-12",
      budget: 1200,
      travelStyle: "food-culture",
      profile: {
        party: "couple",
        pace: "balanced",
        interests: ["ramen", "museums"],
        constraints: { dietary: "no shellfish" },
        budget: 1200,
        travelStyle: "food-culture"
      }
    },
    attempts: 1
  });
  jobId = job.id;

  job.status === "queued" ? ok("trip_plan job enqueued") : no(`status=${job.status}`);

  const done = await waitFor(job.id, (j) => j.status === "succeeded" || j.status === "failed");
  done?.status === "succeeded" ? ok("trip_plan worker succeeded") : no(`ended ${done?.status}: ${done?.error ?? ""}`);
  done?.progress === 100 ? ok("progress reached 100") : no(`progress=${done?.progress}`);
  const output = done?.output as { status?: string; mode?: string; runId?: string | null };
  output?.status === "plan_ready" ? ok("worker output persisted") : no("worker output missing");
  output?.mode === "ai" ? ok("worker reported AI generation mode only") : no(`mode=${output?.mode}`);

  const [version] = await queryAurora<{ id: string; generation_mode: string; total_estimate: string; planning_context: Record<string, unknown> }>(
    `select id, generation_mode, total_estimate, planning_context from trip_plan_versions where trip_id = $1 order by version desc limit 1`,
    [tripId]
  );
  version?.generation_mode === output?.mode ? ok("generation mode persisted for audit") : no(`generation_mode=${version?.generation_mode}`);
  version?.id ? ok("plan version persisted") : no("plan version missing");
  Number(version?.total_estimate ?? 0) > 0 ? ok("total estimate persisted") : no(`total=${version?.total_estimate}`);
  output.runId ? ok("AI crew returned agent run id") : no("AI run id missing");
  version.planning_context?.agentRunId ? ok("agent run id persisted in planning context") : no("agent run id missing from context");

  const [dayCount] = await queryAurora<{ c: string }>(
    `select count(*) c from itinerary_days where plan_version_id = $1`,
    [version?.id ?? ""]
  );
  Number(dayCount?.c ?? 0) === 3 ? ok("three itinerary days persisted") : no(`days=${dayCount?.c}`);

  const [itemCount] = await queryAurora<{ c: string }>(
    `select count(*) c from itinerary_items where plan_version_id = $1`,
    [version?.id ?? ""]
  );
  Number(itemCount?.c ?? 0) >= 6 ? ok("itinerary items persisted") : no(`items=${itemCount?.c}`);

  const [evidenceCount] = await queryAurora<{ c: string }>(
    `select count(*) c from itinerary_items where plan_version_id = $1 and cost_rationale is not null`,
    [version?.id ?? ""]
  );
  Number(evidenceCount?.c ?? 0) >= 1 ? ok("item cost rationale persisted") : no(`cost rationale rows=${evidenceCount?.c}`);

  const [readyTrip] = await queryAurora<{ status: string }>(`select status from trips where id = $1`, [tripId]);
  readyTrip?.status === "ready" ? ok("trip marked ready") : no(`trip status=${readyTrip?.status}`);
} finally {
  await worker.close();
  await closeQueues();
  if (jobId) await queryAurora(`delete from agent_jobs where id = $1`, [jobId]).catch(() => {});
  if (tripId) await queryAurora(`delete from trips where id = $1`, [tripId]).catch(() => {});
  if (travelerId) await queryAurora(`delete from users where id = $1`, [travelerId]).catch(() => {});
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
