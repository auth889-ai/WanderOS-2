-- 004_listing_videos.sql — the Full Premium Tour / Cinematic Reel persistence (P10)
-- listing_videos: the render MANIFEST + result (source of truth the UI reads via SSE).
-- clip_cache:     content-addressed rendered clips → cheap unlimited re-renders.
-- listings.tour:  denormalized pointer so detail/marketplace pages read the video fast.

create table if not exists listing_videos (
  id            uuid primary key default gen_random_uuid(),
  listing_id    uuid not null references listings(id) on delete cascade,
  host_id       uuid references users(id),
  type          text not null default 'tour',        -- 'tour' (narrated) | 'reel' (no voice)
  mode          text not null default 'walkthrough', -- walkthrough|day_to_dusk|staging_reveal|drone|social_reel
  resolution    text not null default '1080p',
  status        text not null default 'queued',      -- queued|planning|narrating|rendering|composing|publishing|ready|failed|cancelled
  brief         jsonb not null default '{}',
  manifest      jsonb not null default '{}',         -- { shots: [{ photoIndex, room, motionPrompt, caption, narration, provider, durationSec }] }
  url           text,
  thumbnail_url text,
  duration_sec  numeric,
  cost_cents    int  not null default 0,
  agent_job_id  uuid references agent_jobs(id) on delete set null,
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists listing_videos_listing_idx on listing_videos (listing_id, created_at desc);
create index if not exists listing_videos_status_idx  on listing_videos (status);

create table if not exists clip_cache (
  cache_key   text primary key,                      -- sha256(photoHash | mode | motionPrompt | provider | duration | resolution)
  clip_url    text not null,                         -- Cloudinary URL of the rendered clip
  provider    text,
  cost_cents  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- fast pointer on the listing for read pages: { video_id, type, url, thumbnail, status }
alter table listings add column if not exists tour jsonb not null default '{}';
