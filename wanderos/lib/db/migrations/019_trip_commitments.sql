-- Commitments — the bookings a trip depends on, and what depends on what.
--
-- A trip has never been a list of bookings. It is a chain where each one needs
-- the previous to finish in time, and that dependency is invisible until it
-- fails. Storing bookings without the edges between them is why every itinerary
-- app can say "your flight is late" and none can say "and your hotel is gone".
--
-- Three columns here do the work no itinerary organiser keeps:
--
--   refundable     whether a missed booking is a real financial loss
--   hard_deadline  "reception closes at 23:00" — why a delay strands someone
--   value          what the loss actually is
--
-- They come out of the confirmation the traveller photographed, and they feed
-- the cascade's expected-loss and hard-deadline logic directly.

create table if not exists trip_commitments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  key text not null,                       -- stable within a trip: 'flight', 'hotel'
  label text not null,
  kind text not null default 'booking'
    check (kind in ('flight', 'connection', 'transfer', 'stay', 'event', 'booking')),
  starts_at timestamptz,

  -- Money at stake. NULL means unknown, which is NOT zero — an unpriced
  -- booking is excluded from the total and reported separately rather than
  -- silently counted as costless.
  value numeric,
  currency text not null default 'GBP',

  -- Unknown refundability defaults to FALSE. Assuming a booking is refundable
  -- understates the loss on exactly the bookings that hurt most.
  refundable boolean not null default false,

  hard_deadline timestamptz,
  consequence text not null default '',

  -- Provenance. Nothing extracted by OCR is a confirmed fact until the
  -- traveller says so, and a field nobody can check is a field nobody should
  -- trust.
  source text not null default 'traveller'
    check (source in ('assumed','inferred','third_party','measured','traveller','official')),
  confidence numeric not null default 1.0,
  needs_review boolean not null default false,
  extracted_from jsonb not null default '{}',

  created_at timestamptz not null default now(),
  unique (trip_id, key)
);

create index if not exists trip_commitments_trip_idx
  on trip_commitments(trip_id, starts_at);

-- The edges. `slack_minutes` is the entire safety margin;
-- `transfer_minutes` is the part already spoken for by walking a terminal or
-- clearing immigration. Slack that is already committed is not slack.
create table if not exists trip_dependencies (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  upstream_key text not null,
  downstream_key text not null,
  slack_minutes numeric not null default 0,
  transfer_minutes numeric not null default 0,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (trip_id, upstream_key, downstream_key),
  check (upstream_key <> downstream_key)
);

create index if not exists trip_dependencies_trip_idx
  on trip_dependencies(trip_id);

-- What Guardian actually DID. A node on the board turns purple only when a row
-- exists here, so the colour is a claim with evidence rather than decoration.
create table if not exists trip_protections (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  commitment_key text not null,
  action text not null,
  acted_by text not null default 'guardian',
  reversible_until timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists trip_protections_trip_idx
  on trip_protections(trip_id, commitment_key);
