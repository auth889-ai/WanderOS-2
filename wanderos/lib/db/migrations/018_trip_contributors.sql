-- Collaborative Trip Inbox — a group trip's photos live on several phones.
--
-- Mother has 30 photos, father has 12 videos, a friend has the restaurant clips,
-- and the organiser has the booking PDF and voice notes. One person's upload can
-- never produce the complete story, and "only one person can add photos to a
-- trip" is the single most-cited structural complaint about existing trip apps.

create table if not exists memory_invites (
  token       text primary key,
  job_id      uuid not null references memory_jobs(id) on delete cascade,
  label       text,                       -- what the organiser called this invite
  max_uses    int,                        -- null = unlimited
  used_count  int  not null default 0,
  revoked_at  timestamptz,
  expires_at  timestamptz,
  created_by  uuid not null,
  created_at  timestamptz not null default now()
);

create table if not exists memory_contributors (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references memory_jobs(id) on delete cascade,
  -- Nullable: a contributor may join by link without a WanderOS account. Their
  -- display name is how they appear in the passport.
  user_id       uuid,
  display_name  text not null,
  invite_token  text references memory_invites(token),
  -- Consent is PER CONTRIBUTOR, not per trip. Someone can share photos for the
  -- family film while refusing to appear in anything public.
  consent       text not null default 'private_only',  -- public | private_only | withdrawn
  is_minor      boolean not null default false,        -- requires guardian_for to be set
  guardian_for  uuid references memory_contributors(id),
  removed_at    timestamptz,
  created_at    timestamptz not null default now(),
  unique (job_id, display_name)
);

-- Which contributor supplied which asset. Needed so a contributor who withdraws
-- can have exactly their material excluded, and so the passport can attribute
-- each moment.
create table if not exists memory_asset_sources (
  job_id         uuid not null references memory_jobs(id) on delete cascade,
  asset_key      text not null,
  contributor_id uuid not null references memory_contributors(id) on delete cascade,
  sha256         text,          -- lets the same photo from two phones collapse to one
  created_at     timestamptz not null default now(),
  primary key (job_id, asset_key)
);

create index if not exists memory_contributors_job_idx on memory_contributors(job_id);
create index if not exists memory_asset_sources_contrib_idx on memory_asset_sources(contributor_id);
create index if not exists memory_asset_sources_sha_idx on memory_asset_sources(job_id, sha256);

comment on column memory_contributors.consent is
  'Per-contributor, not per-trip. withdrawn = exclude every asset they supplied.';
comment on table memory_asset_sources is
  'Attribution. Also the dedup seam: two phones uploading the same photo share a sha256.';
