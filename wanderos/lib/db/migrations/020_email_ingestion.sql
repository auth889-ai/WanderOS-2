-- Email ingestion — imports, extractions, corrections, evidence, outbox.
--
-- Five tables because five things must be separable after the fact. When an
-- itinerary turns out wrong, the only way to tell whether the sender, the
-- parser or the reviewer was at fault is to have kept each one apart:
--
--   what arrived        email_imports        (raw, verbatim, idempotent)
--   what we read        email_extractions    (per field, with its tier)
--   what a human said   extraction_corrections
--   what proves it      extraction_evidence  (page + source line)
--   what happens next   ingestion_outbox     (exactly-once side effects)

create table if not exists email_imports (
  id uuid primary key default gen_random_uuid(),
  -- Postmark's MessageID. UNIQUE is the whole idempotency guarantee: webhooks
  -- retry on any non-2xx, and without this a slow response becomes two
  -- itineraries.
  message_id text not null unique,
  trip_id uuid references trips(id) on delete cascade,
  from_address text not null default '',
  subject text not null default '',
  received_at timestamptz not null default now(),

  -- Pointer to the verbatim original in object storage. When an extraction is
  -- disputed, re-reading exactly what arrived is the only way to settle it.
  raw_ref text not null default '',
  attachment_count int not null default 0,

  status text not null default 'received'
    check (status in ('received','extracted','needs_review','committed','rejected','failed')),
  failure_reason text not null default ''
);

create index if not exists email_imports_trip_idx on email_imports(trip_id, received_at desc);
create index if not exists email_imports_status_idx on email_imports(status);

-- One row per extracted booking. `tier` records HOW it was read, which is what
-- lets a later, stronger read supersede a weaker one without guesswork.
create table if not exists email_extractions (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references email_imports(id) on delete cascade,

  tier text not null check (tier in ('json-ld','barcode','ocr','model','none')),
  classification text not null default 'new'
    check (classification in ('new','duplicate','update','cancellation')),
  matched_commitment_key text,

  -- The extracted booking as read, before any human touched it. Kept whole so
  -- a correction can always be diffed against the original.
  payload jsonb not null default '{}',
  confidence numeric not null default 0,

  requires_review boolean not null default true,
  review_reasons text[] not null default '{}',

  created_at timestamptz not null default now()
);

create index if not exists email_extractions_import_idx on email_extractions(import_id);

-- Corrections live SEPARATELY from extractions, never on top of them. Editing
-- the extraction in place would destroy the evidence of what the parser
-- actually produced, and with it any chance of improving it.
create table if not exists extraction_corrections (
  id uuid primary key default gen_random_uuid(),
  extraction_id uuid not null references email_extractions(id) on delete cascade,
  field text not null,
  original_value text,
  corrected_value text,
  corrected_by text not null default 'traveller',
  corrected_at timestamptz not null default now(),
  unique (extraction_id, field)
);

-- Where each field came from, down to the page and the printed line. This is
-- what a review screen shows beside the extracted value.
create table if not exists extraction_evidence (
  id uuid primary key default gen_random_uuid(),
  extraction_id uuid not null references email_extractions(id) on delete cascade,
  field text not null,
  source_text text not null default '',
  page int,
  evidence_ref text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists extraction_evidence_idx on extraction_evidence(extraction_id);

-- Outbox: side effects recorded in the SAME transaction as the commit.
--
-- Rebuilding the Pulse board, running the cascade and notifying Action
-- Autopilot must not happen inside the write — a failure there would roll back
-- a booking the traveller already approved. Recording the intent atomically and
-- draining it afterwards is the standard way to get exactly-once behaviour out
-- of a database that cannot enlist an HTTP call in its transaction.
create table if not exists ingestion_outbox (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  event_type text not null
    check (event_type in ('commitment_committed','commitment_updated','commitment_cancelled')),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts int not null default 0,
  last_error text not null default ''
);

create index if not exists ingestion_outbox_pending_idx
  on ingestion_outbox(created_at) where processed_at is null;

-- Ties a commitment back to the email that created it, and makes a second
-- delivery of the same message physically unable to create a second commitment.
alter table trip_commitments
  add column if not exists import_id uuid references email_imports(id) on delete set null;

alter table trip_commitments
  add column if not exists reference text;

create unique index if not exists trip_commitments_reference_idx
  on trip_commitments(trip_id, reference) where reference is not null and reference <> '';
