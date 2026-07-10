-- 006_trip_plan_versions.sql — AI itinerary plan versioning foundation.
-- One trip can have many generated/edited plan versions. The active version is selected by status.

create table if not exists trip_plan_versions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  version int not null,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  generation_mode text not null default 'ai'
    check (generation_mode in ('ai', 'manual', 'fallback')),
  input_snapshot jsonb not null default '{}',
  planning_context jsonb not null default '{}',
  ai_summary text,
  verifier_report jsonb not null default '{}',
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (trip_id, version)
);

create index if not exists trip_plan_versions_trip_idx
  on trip_plan_versions(trip_id, version desc);
