-- 008_trip_planner.sql — premium AI trip planner fields.
-- Extends the existing trip/version/day/item foundation without changing service behavior yet.

alter table trips
  add column if not exists profile jsonb not null default '{}';

alter table trip_plan_versions
  add column if not exists total_estimate numeric not null default 0;

alter table itinerary_days
  add column if not exists area text;

alter table itinerary_items
  add column if not exists plan_version_id uuid references trip_plan_versions(id) on delete cascade,
  add column if not exists est_cost numeric not null default 0,
  add column if not exists locked boolean not null default false,
  add column if not exists stay_listing_id uuid references listings(id);

create index if not exists itinerary_items_version_idx
  on itinerary_items(plan_version_id, day_number);
