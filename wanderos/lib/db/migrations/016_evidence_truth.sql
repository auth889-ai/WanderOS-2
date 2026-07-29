-- Truth model: multi-modal evidence and the claim set it produces.
--
-- Claims are stored on the job (not a side table) because they are versioned
-- with it and always read as a whole set — the consent gate needs every claim's
-- status at once to decide what may be generated.

alter table memory_jobs
  add column if not exists evidence jsonb,
  add column if not exists claims jsonb default '[]'::jsonb,
  add column if not exists consent_decisions jsonb default '{}'::jsonb;

-- The job pauses here for the traveler to confirm moments no photo can prove.
alter table memory_jobs drop constraint if exists memory_jobs_status_check;
alter table memory_jobs add constraint memory_jobs_status_check check (
  status in (
    'intake', 'collecting', 'understanding',
    'awaiting_consent',
    'planning', 'awaiting_storyboard_approval',
    'generating', 'critiquing', 'awaiting_final_approval',
    'delivering', 'delivered', 'failed'
  )
);

comment on column memory_jobs.claims is
  'Claim set with truth status per moment. Only USER_CONFIRMED and SYNTHETIC may be visually recreated.';
