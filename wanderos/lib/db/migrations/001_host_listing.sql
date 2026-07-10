-- 001_host_listing.sql
-- Host domain: complete the listing schema (detail fields) + photo gallery + availability.
-- Idempotent: safe to run multiple times.

-- ── listings: full detail fields (travelmate parity) ──────────────────────────
alter table listings add column if not exists bedrooms     int;
alter table listings add column if not exists bathrooms    int;
alter table listings add column if not exists max_guests   int;
alter table listings add column if not exists address      text;
alter table listings add column if not exists lat          numeric;
alter table listings add column if not exists lng          numeric;
alter table listings add column if not exists house_rules  text;
-- (amenities, rooms, quality_score, pricing_analysis, tour, status already exist)

-- ── listing_media: photo/video gallery (1..N per listing) ─────────────────────
create table if not exists listing_media (
  id            uuid primary key default gen_random_uuid(),
  listing_id    uuid not null references listings(id) on delete cascade,
  url           text not null,
  type          text not null default 'image' check (type in ('image', 'video')),
  caption       text,
  detected_room text,
  enhanced_url  text,
  is_enhanced   boolean not null default false,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists listing_media_listing_idx on listing_media(listing_id);

-- ── listing_availability: bookable / blocked date ranges ──────────────────────
create table if not exists listing_availability (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references listings(id) on delete cascade,
  start_date   date not null,
  end_date     date not null,
  is_available boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists listing_availability_listing_idx on listing_availability(listing_id);
