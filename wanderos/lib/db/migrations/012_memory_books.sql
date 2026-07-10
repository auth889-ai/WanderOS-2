-- Memory Book: one `doc` jsonb per book (spreads → pages → layers), plus explicit version snapshots.
-- Replaces the old empty scaffold table (jar_id/chapters/share_slug) — 0 rows, unused.
drop table if exists memory_book_versions cascade;
drop table if exists memory_books cascade;

create table if not exists memory_books (
  id uuid primary key default gen_random_uuid(),
  traveler_id uuid not null references users(id),
  trip_id uuid references trips(id) on delete set null,
  title text not null default 'My Memory Book',
  cover_url text,
  theme text not null default 'vintage',
  status text not null default 'building',          -- building | ready | failed
  doc jsonb not null default '{"spreads":[]}',
  agent_job_id uuid references agent_jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists memory_book_versions (
  id uuid primary key default gen_random_uuid(),
  memory_book_id uuid not null references memory_books(id) on delete cascade,
  version int not null,
  doc jsonb not null,
  created_at timestamptz not null default now(),
  unique (memory_book_id, version)
);

create index if not exists memory_books_traveler_idx on memory_books(traveler_id, created_at desc);
