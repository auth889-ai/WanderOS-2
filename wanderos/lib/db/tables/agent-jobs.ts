import { queryAurora } from "../pool";

/**
 * The only module that touches agent_jobs — the durable STATE of every heavy async job
 * (the studio, listing-video, and trip-planner crews). BullMQ/Redis schedules the work; this row is the
 * source of truth the UI reads (via SSE) for progress/status, and what survives a worker restart.
 */
export type JobType = "studio" | "listing_video" | "trip_plan" | "social_post" | "memory_build" | "jar_movie";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type AgentJobRow = {
  id: string;
  type: JobType;
  status: JobStatus;
  listing_id: string | null;
  user_id: string | null;
  idempotency_key: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  progress: number;
  current_stage: string | null;
  run_id: string | null;
  error: string | null;
  attempts: number;
  max_attempts: number;
  cancel_requested: boolean;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
};

/**
 * Create a job — IDEMPOTENT on idempotency_key: a duplicate submit returns the SAME row instead of
 * creating a second job/listing. (BullMQ uses idempotency_key as its jobId for the same guarantee.)
 */
export async function createJob(params: {
  type: JobType;
  listingId?: string | null;
  userId?: string | null;
  idempotencyKey: string;
  input: Record<string, unknown>;
}): Promise<AgentJobRow> {
  const rows = await queryAurora<AgentJobRow>(
    `insert into agent_jobs (type, listing_id, user_id, idempotency_key, input)
     values ($1, $2, $3, $4, $5::jsonb)
     on conflict (idempotency_key) do update set updated_at = now()
     returning *`,
    [params.type, params.listingId ?? null, params.userId ?? null, params.idempotencyKey, JSON.stringify(params.input)]
  );
  return rows[0];
}

export async function getJob(id: string): Promise<AgentJobRow | null> {
  const rows = await queryAurora<AgentJobRow>(`select * from agent_jobs where id = $1`, [id]);
  return rows[0] ?? null;
}

export async function getJobByKey(idempotencyKey: string): Promise<AgentJobRow | null> {
  const rows = await queryAurora<AgentJobRow>(`select * from agent_jobs where idempotency_key = $1`, [idempotencyKey]);
  return rows[0] ?? null;
}

/** Worker picks up a job: status=running, attempts++, link the crew run, stamp started_at. */
export async function markRunning(id: string, runId?: string | null): Promise<AgentJobRow | null> {
  const rows = await queryAurora<AgentJobRow>(
    `update agent_jobs
       set status = 'running', attempts = attempts + 1, run_id = coalesce($2, run_id),
           started_at = coalesce(started_at, now()), updated_at = now()
     where id = $1 returning *`,
    [id, runId ?? null]
  );
  return rows[0] ?? null;
}

/** Live progress for the SSE stream: 0-100 + which stage/agent is running now. */
export async function updateProgress(id: string, progress: number, currentStage: string): Promise<void> {
  await queryAurora(
    `update agent_jobs set progress = $2, current_stage = $3, updated_at = now() where id = $1`,
    [id, Math.max(0, Math.min(100, Math.round(progress))), currentStage]
  );
}

export async function markSucceeded(id: string, output: Record<string, unknown>): Promise<AgentJobRow | null> {
  const rows = await queryAurora<AgentJobRow>(
    `update agent_jobs
       set status = 'succeeded', output = $2::jsonb, progress = 100, error = null,
           finished_at = now(), updated_at = now()
     where id = $1 returning *`,
    [id, JSON.stringify(output)]
  );
  return rows[0] ?? null;
}

export async function markFailed(id: string, error: string): Promise<AgentJobRow | null> {
  const rows = await queryAurora<AgentJobRow>(
    `update agent_jobs set status = 'failed', error = $2, finished_at = now(), updated_at = now()
     where id = $1 returning *`,
    [id, error.slice(0, 2000)]
  );
  return rows[0] ?? null;
}

/** Host requests cancellation; the worker honors it between stages and sets status='cancelled'. */
export async function requestCancel(id: string): Promise<AgentJobRow | null> {
  const rows = await queryAurora<AgentJobRow>(
    `update agent_jobs set cancel_requested = true, updated_at = now()
     where id = $1 and status in ('queued','running') returning *`,
    [id]
  );
  return rows[0] ?? null;
}

export async function markCancelled(id: string): Promise<AgentJobRow | null> {
  const rows = await queryAurora<AgentJobRow>(
    `update agent_jobs set status = 'cancelled', finished_at = now(), updated_at = now()
     where id = $1 returning *`,
    [id]
  );
  return rows[0] ?? null;
}

/** All jobs for a listing (newest first) — used by the host UI + SSE. */
export async function listJobsForListing(listingId: string): Promise<AgentJobRow[]> {
  return queryAurora<AgentJobRow>(
    `select * from agent_jobs where listing_id = $1 order by created_at desc`,
    [listingId]
  );
}

/** All trip_plan jobs for a trip, keyed through the durable job input. Ownership is enforced in services/routes. */
export async function listJobsForTrip(tripId: string): Promise<AgentJobRow[]> {
  return queryAurora<AgentJobRow>(
    `select *
       from agent_jobs
      where type = 'trip_plan'
        and input->>'tripId' = $1
      order by created_at desc`,
    [tripId]
  );
}

/** All social_post jobs for a post, keyed through durable job input. Ownership is enforced in services/routes. */
export async function listJobsForPost(postId: string): Promise<AgentJobRow[]> {
  return queryAurora<AgentJobRow>(
    `select *
       from agent_jobs
      where type = 'social_post'
        and input->>'postId' = $1
      order by created_at desc`,
    [postId]
  );
}
