-- 015_memory_progress.sql — align Autopilot with the house SSE-from-a-DB-row pattern.
-- The worker persists every pipeline event here; /api/memory/[id]/stream polls this row.
-- (Redis pub/sub remains worker-internal transport only; the row is the source of truth.)

alter table memory_jobs
  add column if not exists progress jsonb not null default '[]'::jsonb,
  add column if not exists current_stage text,
  add column if not exists progress_pct int not null default 0;
