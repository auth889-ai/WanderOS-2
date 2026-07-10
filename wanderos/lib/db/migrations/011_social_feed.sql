-- 011_social_feed.sql - social-commerce feed foundation.
-- Extends the existing simple travel_posts table instead of creating a duplicate feed table.

alter table travel_posts
  add column if not exists listing_id uuid references listings(id) on delete set null,
  add column if not exists booking_id uuid references bookings(id) on delete set null,
  add column if not exists status text not null default 'published'
    check (status in ('draft', 'pending_review', 'published', 'rejected', 'deleted')),
  add column if not exists post_type text not null default 'text'
    check (post_type in ('text', 'photo', 'carousel', 'reel', 'trip_recap')),
  add column if not exists body text,
  add column if not exists destination text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists visibility text not null default 'public'
    check (visibility in ('public', 'private')),
  add column if not exists verified_stay boolean not null default false,
  add column if not exists ai_summary text,
  add column if not exists moderation_status text not null default 'not_reviewed'
    check (moderation_status in ('not_reviewed', 'pending_review', 'approved', 'rejected', 'blocked')),
  add column if not exists moderation_report jsonb not null default '{}',
  add column if not exists compose_job_id uuid references agent_jobs(id) on delete set null,
  add column if not exists like_count int not null default 0,
  add column if not exists save_count int not null default 0,
  add column if not exists comment_count int not null default 0,
  add column if not exists view_count int not null default 0,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references travel_posts(id) on delete cascade,
  media_url text not null,
  media_kind text not null default 'photo'
    check (media_kind in ('photo', 'video', 'reel')),
  sort_order int not null default 0,
  cloudinary_public_id text,
  width int,
  height int,
  duration_seconds numeric,
  ai_description text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (post_id, sort_order)
);

create table if not exists post_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references travel_posts(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('like', 'love', 'fire', 'wow')),
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);

create table if not exists post_saves (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references travel_posts(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  collection_name text not null default 'default',
  created_at timestamptz not null default now(),
  unique (post_id, user_id, collection_name)
);

create table if not exists post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references travel_posts(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  parent_id uuid references post_comments(id) on delete cascade,
  body text not null,
  status text not null default 'visible'
    check (status in ('visible', 'hidden', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists follows (
  follower_id uuid not null references users(id) on delete cascade,
  following_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create table if not exists post_booking_attributions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references travel_posts(id) on delete cascade,
  viewer_id uuid references users(id) on delete set null,
  listing_id uuid references listings(id) on delete set null,
  booking_id uuid references bookings(id) on delete set null,
  attribution_type text not null check (attribution_type in ('click', 'booking')),
  created_at timestamptz not null default now()
);

create index if not exists travel_posts_public_feed_idx
  on travel_posts(status, visibility, created_at desc)
  where status = 'published' and visibility = 'public';

create index if not exists travel_posts_author_idx
  on travel_posts(author_id, created_at desc);

create index if not exists travel_posts_listing_idx
  on travel_posts(listing_id, created_at desc)
  where listing_id is not null;

create index if not exists travel_posts_booking_idx
  on travel_posts(booking_id)
  where booking_id is not null;

create index if not exists post_media_post_idx
  on post_media(post_id, sort_order);

create index if not exists post_reactions_post_idx
  on post_reactions(post_id, kind);

create index if not exists post_saves_user_idx
  on post_saves(user_id, created_at desc);

create index if not exists post_comments_post_idx
  on post_comments(post_id, created_at);

create index if not exists follows_following_idx
  on follows(following_id, follower_id);

create index if not exists post_booking_attr_post_idx
  on post_booking_attributions(post_id, created_at desc);

create index if not exists post_booking_attr_booking_idx
  on post_booking_attributions(booking_id)
  where booking_id is not null;
