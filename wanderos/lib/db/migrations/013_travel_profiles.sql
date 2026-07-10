-- Saved, editable traveler intelligence input (budget · interests · home country · last query).
create table if not exists travel_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  budget text,
  interests jsonb not null default '[]',
  home_country text,
  last_query text,
  updated_at timestamptz not null default now()
);
