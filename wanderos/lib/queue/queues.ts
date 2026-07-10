import { Queue } from "bullmq";
import { redisConnectionOptions } from "./connection";
import { createJob, JobType, AgentJobRow } from "@/lib/db/tables/agent-jobs";

/** One BullMQ queue per job type. */
export const QUEUE_NAMES: Record<JobType, string> = {
  studio: "studio",
  listing_video: "listing_video",
  trip_plan: "trip_plan",
  social_post: "social_post",
  memory_build: "memory_build",
  jar_movie: "jar_movie"
};

const queues = new Map<string, Queue>();

function getQueue(name: string): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: redisConnectionOptions(),
      defaultJobOptions: {
        attempts: 3, // failure recovery
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 }
      }
    });
    queues.set(name, q);
  }
  return q;
}

export type EnqueueParams = {
  type: JobType;
  listingId?: string | null;
  userId?: string | null;
  idempotencyKey: string;
  input: Record<string, unknown>;
  attempts?: number; // override the queue default (3) — e.g. tests use 1 to cap cost
};

/**
 * Enqueue a job: write the durable agent_jobs row (idempotent on the key) AND add it to BullMQ.
 * BullMQ `jobId = idempotencyKey` → a duplicate submit/delivery is a no-op (matches the Aurora row).
 * The BullMQ payload only carries the agent_jobs id; the worker reads the rest from Aurora.
 */
export async function enqueueJob(params: EnqueueParams): Promise<AgentJobRow> {
  const row = await createJob({
    type: params.type,
    listingId: params.listingId,
    userId: params.userId,
    idempotencyKey: params.idempotencyKey,
    input: params.input
  });
  // BullMQ custom jobIds can't contain ':' (and a few other chars) — sanitize for the queue.
  // The Aurora idempotency_key keeps its original form; both dedupe consistently for the same input.
  const bullJobId = params.idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, "-");
  await getQueue(QUEUE_NAMES[params.type]).add(
    params.type,
    { agentJobId: row.id },
    { jobId: bullJobId, ...(params.attempts ? { attempts: params.attempts } : {}) }
  );
  return row;
}

/** Remove a still-queued BullMQ job (used when a host cancels before the worker picks it up). */
export async function removeQueuedJob(type: JobType, idempotencyKey: string): Promise<void> {
  if (!idempotencyKey) return;
  const bullJobId = idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, "-");
  const job = await getQueue(QUEUE_NAMES[type]).getJob(bullJobId);
  if (job) await job.remove().catch(() => {});
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
}
