-- 002_jobs_versions.sql — the JOB FOUNDATION (P1)
-- agent_jobs: the durable state-of-record for heavy async work (studio + listing_video crews).
--   BullMQ/Redis is the courier/scheduler; THIS table is the source of truth the UI reads via SSE.
-- listing_versions: a snapshot per host edit, so the host can see history / restore (edit-anytime).

create table if not exists agent_jobs (
  id               uuid primary key default gen_random_uuid(),
  type             text not null,                       -- 'studio' | 'listing_video'
  status           text not null default 'queued',      -- queued | running | succeeded | failed | cancelled
  listing_id       uuid references listings(id) on delete cascade,
  user_id          uuid references users(id),
  idempotency_key  text unique,                         -- dedupe: same submit -> same job (BullMQ jobId)
  input            jsonb not null default '{}',
  output           jsonb not null default '{}',
  progress         int  not null default 0,             -- 0-100, streamed to the UI
  current_stage    text,                                -- e.g. 'property-vision' (which agent is running)
  run_id           uuid references agent_runs(id),      -- links to the crew's agent_steps trace
  error            text,
  attempts         int  not null default 0,
  max_attempts     int  not null default 3,
  cancel_requested boolean not null default false,      -- host asked to cancel; worker checks between stages
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz,
  updated_at       timestamptz not null default now()
);

create index if not exists agent_jobs_status_idx  on agent_jobs (status, created_at);
create index if not exists agent_jobs_listing_idx on agent_jobs (listing_id);

create table if not exists listing_versions (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references listings(id) on delete cascade,
  version     int  not null,                            -- 1, 2, 3, ...
  snapshot    jsonb not null,                           -- the full editable listing fields at that point
  edited_by   uuid references users(id),
  note        text,                                     -- optional: what changed / why
  created_at  timestamptz not null default now(),
  unique (listing_id, version)
);

create index if not exists listing_versions_listing_idx on listing_versions (listing_id, version desc);
