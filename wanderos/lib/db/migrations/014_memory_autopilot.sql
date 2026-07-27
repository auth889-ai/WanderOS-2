-- 014_memory_autopilot.sql — WanderOS Autopilot (Backblaze hackathon)
-- memory_jobs: one row per memory-film request; the durable spine the UI reads.
-- approvals + critic_verdicts: the human/AI audit trail (mirrored to B2 as JSON).

create table if not exists memory_jobs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips(id) on delete cascade,
  owner_id uuid not null references users(id) on delete cascade,
  status text not null default 'intake'
    check (status in ('intake','collecting','understanding','planning',
                      'awaiting_storyboard_approval','generating','critiquing',
                      'awaiting_final_approval','delivering','delivered','failed')),
  request_text text not null default '',
  inferred jsonb not null default '{}'::jsonb,          -- {destination, tone, trip_type, confidence...}
  asset_keys text[] not null default '{}',              -- B2 originals/ keys
  timeline jsonb,                                       -- day-by-day memory graph
  storyboard jsonb,                                     -- approved StoryboardSpec
  storyboard_version int not null default 0,
  film_key text,                                        -- B2 final/ sealed film
  film_sha256 text,                                     -- sealed-file hash (matches Object Lock record)
  run_id text,                                          -- genblaze run id → provenance bucket key
  cost jsonb not null default '{}'::jsonb,              -- {usd, wall_ms, cache_savings_usd, steps:[...]}
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memory_jobs_owner_idx on memory_jobs(owner_id, created_at desc);
create index if not exists memory_jobs_status_idx on memory_jobs(status);

create table if not exists memory_approvals (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references memory_jobs(id) on delete cascade,
  checkpoint text not null check (checkpoint in ('storyboard','scene_escalation','final')),
  decision text not null check (decision in ('approved','edited','rejected','revision_requested')),
  payload jsonb not null default '{}'::jsonb,           -- edited storyboard / consents / notes
  actor_id uuid references users(id),
  b2_key text,                                          -- mirror copy in trips/{id}/approvals/
  created_at timestamptz not null default now()
);

create index if not exists memory_approvals_job_idx on memory_approvals(job_id, created_at);

create table if not exists memory_critic_verdicts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references memory_jobs(id) on delete cascade,
  scene_idx int not null,
  attempt int not null default 1,
  scores jsonb not null,                                -- {prompt_match, visual_quality, destination_fidelity, artifacts, overall}
  reason text,
  action text not null check (action in ('accepted','retry_prompt','provider_switch','escalated')),
  provider text,
  model text,
  b2_key text,                                          -- mirror in trips/{id}/critic-results/
  created_at timestamptz not null default now()
);

create index if not exists memory_critic_job_idx on memory_critic_verdicts(job_id, scene_idx, attempt);
