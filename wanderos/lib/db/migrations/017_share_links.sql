-- Public share links for a finished film.
--
-- A random token rather than the job id: job ids appear in logs, URLs and
-- support threads, and a share link is a bearer credential — anyone holding it
-- can view. Keeping them separate means a leaked link can be revoked without
-- touching the job.

create table if not exists memory_shares (
  token         text primary key,
  job_id        uuid not null references memory_jobs(id) on delete cascade,
  audience      text not null default 'public',   -- public | private
  revoked_at    timestamptz,
  expires_at    timestamptz,
  view_count    int not null default 0,
  created_by    uuid,
  created_at    timestamptz not null default now()
);

create index if not exists memory_shares_job_idx on memory_shares(job_id);

comment on column memory_shares.audience is
  'public = sensitivity-filtered cut (private-only moments removed); private = full family cut.';
comment on column memory_shares.token is
  'Bearer credential. Revoke by setting revoked_at rather than deleting, so a leaked link stays dead.';
