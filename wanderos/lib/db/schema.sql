create extension if not exists vector;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text,
  google_id text,
  role text not null check (role in ('traveler', 'host', 'admin')),
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table users add column if not exists password_hash text;
alter table users add column if not exists google_id text;
alter table users add column if not exists updated_at timestamptz not null default now();

create unique index if not exists users_google_id_unique on users(google_id) where google_id is not null;

create table if not exists traveler_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  home_city text,
  budget_level text,
  monthly_budget numeric,
  travel_style text,
  pace text,
  preferred_destinations text[] default '{}'
);

create table if not exists host_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  city text,
  country text,
  bio text,
  verification_status text not null default 'pending'
);

create table if not exists listings (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references users(id),
  title text not null,
  description text not null,
  city text not null,
  country text not null,
  category text not null,
  price numeric not null default 0,
  tags text[] default '{}',
  image_url text,
  moderation_status text not null default 'pending_review',
  created_at timestamptz not null default now()
);

create table if not exists trips (
  id uuid primary key default gen_random_uuid(),
  traveler_id uuid not null references users(id),
  title text not null,
  destination text not null,
  start_date date,
  end_date date,
  budget numeric,
  travel_style text,
  status text not null default 'draft',
  reality_prediction jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists trip_members (
  trip_id uuid not null references trips(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  email text not null,
  name text,
  member_role text not null default 'viewer' check (member_role in ('owner', 'admin', 'editor', 'viewer')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (trip_id, email)
);

create table if not exists itinerary_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  day_number int not null,
  time_label text,
  title text not null,
  description text,
  category text,
  source text not null default 'agent'
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips(id),
  listing_id uuid references listings(id),
  traveler_id uuid not null references users(id),
  host_id uuid not null references users(id),
  status text not null default 'requested',
  created_at timestamptz not null default now()
);

create table if not exists safety_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  priority int not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists safety_sessions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  status text not null default 'active',
  current_city text,
  risk_score numeric not null default 0,
  last_check_in_at timestamptz,
  next_check_in_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists safety_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references safety_sessions(id) on delete cascade,
  event_type text not null,
  severity text not null default 'info',
  signal jsonb not null default '{}',
  recommended_action text,
  created_at timestamptz not null default now()
);

create table if not exists travel_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references users(id),
  trip_id uuid references trips(id),
  title text not null,
  caption text,
  location text,
  media_url text,
  mood text,
  created_at timestamptz not null default now()
);

create table if not exists research_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  trip_id uuid references trips(id),
  url text,
  title text not null,
  summary text,
  destination text,
  tags text[] default '{}',
  source_snapshot jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists extension_intelligence_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  trip_id uuid references trips(id),
  url text not null,
  page_title text,
  destination text,
  page_type text,
  final_card jsonb not null default '{}',
  evidence jsonb not null default '[]',
  verifier_status text not null default 'source_grounded',
  created_at timestamptz not null default now()
);

create table if not exists external_signal_cache (
  id uuid primary key default gen_random_uuid(),
  signal_type text not null,
  cache_key text not null,
  source_name text not null,
  payload jsonb not null default '{}',
  fetched_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (signal_type, cache_key, source_name)
);

create table if not exists memory_jars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  trip_id uuid references trips(id),
  title text not null,
  primary_emotion text,
  replay_plan jsonb not null default '{}',
  visual_config jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists memories (
  id uuid primary key default gen_random_uuid(),
  jar_id uuid not null references memory_jars(id) on delete cascade,
  title text not null,
  caption text,
  location text,
  media_url text,
  emotion jsonb not null default '{}'
);

-- NOTE: memory_books is owned by migration 012_memory_books.sql (doc-jsonb model). Kept out of base schema.

create table if not exists memory_replay_jobs (
  id uuid primary key default gen_random_uuid(),
  jar_id uuid references memory_jars(id) on delete cascade,
  user_id uuid not null references users(id),
  status text not null default 'queued',
  current_stage text,
  progress int not null default 0,
  input jsonb not null default '{}',
  output jsonb not null default '{}',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists revenue_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  trip_id uuid references trips(id),
  booking_id uuid references bookings(id),
  source text not null,
  amount numeric not null default 0,
  currency text not null default 'BDT',
  status text not null default 'recorded',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  workflow text not null,
  status text not null default 'queued',
  input jsonb not null default '{}',
  output jsonb not null default '{}',
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists agent_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references agent_runs(id) on delete cascade,
  agent_name text not null,
  status text not null,
  input_summary text,
  output_summary text,
  tool_used text,
  sequence int not null,
  created_at timestamptz not null default now()
);

create table if not exists embeddings (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null,
  owner_id uuid not null,
  content text not null,
  embedding vector(768),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists embeddings_vector_idx on embeddings using ivfflat (embedding vector_cosine_ops);
create index if not exists safety_sessions_trip_idx on safety_sessions(trip_id);
create index if not exists revenue_events_trip_idx on revenue_events(trip_id);
create index if not exists extension_cards_user_idx on extension_intelligence_cards(user_id, created_at desc);
create index if not exists external_signal_cache_expiry_idx on external_signal_cache(signal_type, expires_at);
create index if not exists memory_replay_jobs_user_idx on memory_replay_jobs(user_id, created_at desc);
