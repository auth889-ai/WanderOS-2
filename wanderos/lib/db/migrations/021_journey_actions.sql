-- Journey actions — the persisted lifecycle of a rescue.
--
-- A Pulse node turns purple only when a row here reaches 'verified' WITH a
-- provider reference. Without that rule "protected" is a colour the UI chose,
-- not a fact about the world, and the traveller would be reassured by nothing.
--
-- The states mirror important.md §5C exactly:
--   detected -> simulated -> priced -> held -> approved -> executed -> verified
-- plus the terminal failures, because a rescue that goes wrong must be as
-- visible as one that goes right.

create table if not exists journey_actions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  commitment_key text not null,

  -- LangGraph thread id. This is what lets a reload resume the SAME paused
  -- graph rather than starting a new one and losing the traveller's approval.
  thread_id text not null unique,

  state text not null default 'detected'
    check (state in ('detected','simulated','priced','held','approved',
                     'executing','verified','rejected','expired','failed')),

  -- The three options as presented. Stored so a reload shows what the traveller
  -- actually saw, not a fresh search that may have moved.
  options jsonb not null default '[]',
  chosen_offer_id text,

  -- Provider truth. A reference the provider issued, never one we generated.
  provider text not null default 'duffel',
  provider_mode text not null default 'sandbox'
    check (provider_mode in ('sandbox','live')),
  provider_order_id text,
  provider_reference text,

  amount numeric,
  currency text not null default 'GBP',

  -- After this the hold lapses. §5C lists it as required; a hold with an
  -- unknown expiry is a trap.
  rollback_deadline timestamptz,

  approved_at timestamptz,
  approved_by text,
  verified_at timestamptz,
  failure_reason text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists journey_actions_trip_idx
  on journey_actions(trip_id, created_at desc);

-- At most one action in flight per commitment. A second rescue for the same
-- broken booking would hold two seats and charge for both.
create unique index if not exists journey_actions_active_idx
  on journey_actions(trip_id, commitment_key)
  where state not in ('rejected','expired','failed','verified');

-- Every transition, append-only. When a traveller asks "what did you do and
-- when", this is the answer — and it is the only way to audit an automated
-- action after the fact.
create table if not exists journey_action_events (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references journey_actions(id) on delete cascade,
  from_state text,
  to_state text not null,
  detail text not null default '',
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists journey_action_events_idx
  on journey_action_events(action_id, created_at);
