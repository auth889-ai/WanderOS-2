-- 007_itinerary_days.sql — day-level rows for versioned AI itinerary plans.
-- Each plan version owns its own ordered set of days, so regeneration never overwrites old plans.

create table if not exists itinerary_days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  plan_version_id uuid not null references trip_plan_versions(id) on delete cascade,
  day_number int not null,
  date date,
  theme text,
  summary text,
  created_at timestamptz not null default now(),
  unique (plan_version_id, day_number)
);

create index if not exists itinerary_days_version_idx
  on itinerary_days(plan_version_id, day_number);
