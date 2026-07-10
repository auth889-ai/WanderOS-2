import { randomUUID } from "crypto";
import { queryAurora } from "@/lib/db/pool";
import { enqueueJob } from "@/lib/queue/queues";
import { requestCancel } from "@/lib/db/tables/agent-jobs";

export type MovieRow = {
  id: string; owner_id: string; title: string | null; status: string; source: string;
  film_url: string | null; thumb_url: string | null; duration_sec: number | null;
  agent_job_id: string | null; created_at: string;
  progress?: number; stage?: string | null; job_status?: string | null;
};

/** Start a movie render: create the row, enqueue jar_movie, link the job. */
export async function startMovie(travelerId: string, input: { title?: string; story?: string; photos?: string[]; source?: string; tier?: "free" | "cinematic" }): Promise<{ movieId: string; jobId: string }> {
  const tier = input.tier === "cinematic" ? "cinematic" : "free";
  const [row] = await queryAurora<{ id: string }>(
    `insert into memory_movies (owner_id, title, status, source) values ($1,$2,'queued',$3) returning id`,
    [travelerId, input.title ?? "My Travel Movie", input.source ?? "past"]
  );
  const job = await enqueueJob({
    type: "jar_movie", userId: travelerId, idempotencyKey: `jar-movie-${row.id}-${randomUUID()}`,
    input: { movieId: row.id, travelerId, title: input.title ?? null, story: input.story ?? null, photos: input.photos ?? null, tier }
  });
  await queryAurora(`update memory_movies set agent_job_id=$2 where id=$1`, [row.id, job.id]).catch(() => {});
  return { movieId: row.id, jobId: job.id };
}

/** Movie + live job progress (owner-scoped). */
export async function getMovie(travelerId: string, id: string): Promise<MovieRow | null> {
  const [row] = await queryAurora<MovieRow>(
    `select m.*, j.progress, j.current_stage as stage, j.status as job_status
       from memory_movies m left join agent_jobs j on j.id = m.agent_job_id
      where m.id = $1 and m.owner_id = $2`,
    [id, travelerId]
  );
  return row ?? null;
}

export async function listMovies(travelerId: string): Promise<MovieRow[]> {
  return queryAurora<MovieRow>(
    `select m.*, j.progress, j.current_stage as stage, j.status as job_status
       from memory_movies m left join agent_jobs j on j.id = m.agent_job_id
      where m.owner_id = $1 order by m.created_at desc limit 20`,
    [travelerId]
  );
}

/** Stop (cancel the running job) and/or delete the movie. Owner-scoped. */
export async function deleteMovie(travelerId: string, id: string): Promise<boolean> {
  const m = await getMovie(travelerId, id);
  if (!m) return false;
  if (m.agent_job_id) await requestCancel(m.agent_job_id).catch(() => {});
  await queryAurora(`delete from memory_movies where id=$1 and owner_id=$2`, [id, travelerId]);
  return true;
}

/** Stop a render without deleting the row (keeps it as 'cancelled'). */
export async function stopMovie(travelerId: string, id: string): Promise<boolean> {
  const m = await getMovie(travelerId, id);
  if (!m) return false;
  if (m.agent_job_id) await requestCancel(m.agent_job_id).catch(() => {});
  await queryAurora(`update memory_movies set status='cancelled', updated_at=now() where id=$1 and owner_id=$2`, [id, travelerId]);
  return true;
}
