import { queryAurora } from "../pool";

/**
 * The only module that touches memory_jobs / memory_approvals / memory_critic_verdicts —
 * the durable state of the Autopilot memory-film workflow. B2 holds the media and the
 * JSON audit mirrors; these rows are the pointers + status the UI and graph read.
 */

export type MemoryJobStatus =
  | "intake"
  | "collecting"
  | "understanding"
  | "planning"
  | "awaiting_storyboard_approval"
  | "generating"
  | "critiquing"
  | "awaiting_final_approval"
  | "delivering"
  | "delivered"
  | "failed";

export type MemoryJobRow = {
  id: string;
  trip_id: string | null;
  owner_id: string;
  status: MemoryJobStatus;
  request_text: string;
  inferred: Record<string, unknown>;
  asset_keys: string[];
  timeline: unknown | null;
  storyboard: unknown | null;
  storyboard_version: number;
  film_key: string | null;
  film_sha256: string | null;
  run_id: string | null;
  cost: Record<string, unknown>;
  error: string | null;
  progress: unknown[];
  current_stage: string | null;
  progress_pct: number;
  created_at: string;
  updated_at: string;
};

export async function createMemoryJob(input: {
  ownerId: string;
  tripId?: string | null;
  requestText: string;
}): Promise<MemoryJobRow> {
  const rows = await queryAurora<MemoryJobRow>(
    `insert into memory_jobs (owner_id, trip_id, request_text)
     values ($1, $2, $3) returning *`,
    [input.ownerId, input.tripId ?? null, input.requestText]
  );
  return rows[0];
}

export async function getMemoryJob(id: string): Promise<MemoryJobRow | null> {
  const rows = await queryAurora<MemoryJobRow>(`select * from memory_jobs where id = $1`, [id]);
  return rows[0] ?? null;
}

export async function getMemoryJobForOwner(id: string, ownerId: string): Promise<MemoryJobRow | null> {
  const rows = await queryAurora<MemoryJobRow>(
    `select * from memory_jobs where id = $1 and owner_id = $2`,
    [id, ownerId]
  );
  return rows[0] ?? null;
}

export async function listMemoryJobsForOwner(ownerId: string): Promise<MemoryJobRow[]> {
  const rows = await queryAurora<MemoryJobRow>(
    `select * from memory_jobs where owner_id = $1 order by created_at desc limit 50`,
    [ownerId]
  );
  return rows;
}

export async function updateMemoryJob(
  id: string,
  patch: Partial<
    Pick<
      MemoryJobRow,
      | "status"
      | "inferred"
      | "asset_keys"
      | "timeline"
      | "storyboard"
      | "storyboard_version"
      | "film_key"
      | "film_sha256"
      | "run_id"
      | "cost"
      | "error"
    >
  >
): Promise<MemoryJobRow | null> {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (keys.length === 0) return getMemoryJob(id);
  const sets = keys.map((k, i) => `${String(k)} = $${i + 2}`).join(", ");
  const values = keys.map((k) => {
    const v = patch[k];
    return typeof v === "object" && v !== null && !Array.isArray(v) ? JSON.stringify(v) : v;
  });
  const rows = await queryAurora<MemoryJobRow>(
    `update memory_jobs set ${sets}, updated_at = now() where id = $1 returning *`,
    [id, ...values]
  );
  return rows[0] ?? null;
}

/**
 * Append a pipeline event to the job's progress log (capped at 200 entries) and update
 * the stage/pct summary. House pattern: SSE routes poll THIS row — never a socket.
 */
export async function appendProgress(
  id: string,
  event: { event: string; [k: string]: unknown },
  stage?: string,
  pct?: number
): Promise<void> {
  await queryAurora(
    `update memory_jobs
       set progress = (
             case when jsonb_array_length(progress) >= 200
                  then progress #- '{0}' else progress end
           ) || $2::jsonb,
           current_stage = coalesce($3, current_stage),
           progress_pct = coalesce($4, progress_pct),
           updated_at = now()
     where id = $1`,
    [id, JSON.stringify([{ ...event, ts: new Date().toISOString() }]), stage ?? null, pct ?? null]
  );
}

export async function appendAssetKeys(id: string, keys: string[]): Promise<void> {
  await queryAurora(
    `update memory_jobs
       set asset_keys = (select array(select distinct unnest(asset_keys || $2::text[]))),
           updated_at = now()
     where id = $1`,
    [id, keys]
  );
}

export async function recordApproval(input: {
  jobId: string;
  checkpoint: "storyboard" | "scene_escalation" | "final";
  decision: "approved" | "edited" | "rejected" | "revision_requested";
  payload?: unknown;
  actorId?: string | null;
  b2Key?: string | null;
}): Promise<string> {
  const rows = await queryAurora<{ id: string }>(
    `insert into memory_approvals (job_id, checkpoint, decision, payload, actor_id, b2_key)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [input.jobId, input.checkpoint, input.decision, JSON.stringify(input.payload ?? {}), input.actorId ?? null, input.b2Key ?? null]
  );
  return rows[0].id;
}

export async function recordCriticVerdict(input: {
  jobId: string;
  sceneIdx: number;
  attempt: number;
  scores: Record<string, number>;
  reason: string | null;
  action: "accepted" | "retry_prompt" | "provider_switch" | "escalated";
  provider?: string | null;
  model?: string | null;
  b2Key?: string | null;
}): Promise<void> {
  await queryAurora(
    `insert into memory_critic_verdicts (job_id, scene_idx, attempt, scores, reason, action, provider, model, b2_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.jobId,
      input.sceneIdx,
      input.attempt,
      JSON.stringify(input.scores),
      input.reason,
      input.action,
      input.provider ?? null,
      input.model ?? null,
      input.b2Key ?? null
    ]
  );
}

export async function listCriticVerdicts(jobId: string) {
  const rows = await queryAurora(
    `select * from memory_critic_verdicts where job_id = $1 order by scene_idx, attempt`,
    [jobId]
  );
  return rows;
}

export async function listApprovals(jobId: string) {
  const rows = await queryAurora(
    `select * from memory_approvals where job_id = $1 order by created_at`,
    [jobId]
  );
  return rows;
}
