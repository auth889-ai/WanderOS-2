-- 009_trip_item_enrichment.sql — provider-backed place, image, and cost evidence for itinerary items.
-- AI can suggest activities, but persisted traveler-facing facts should carry source/rationale fields.

alter table itinerary_items
  add column if not exists place_name text,
  add column if not exists place_address text,
  add column if not exists place_url text,
  add column if not exists external_place_id text,
  add column if not exists place_rating numeric,
  add column if not exists image_url text,
  add column if not exists image_attribution jsonb not null default '{}',
  add column if not exists cost_source text,
  add column if not exists cost_rationale text,
  add column if not exists metadata jsonb not null default '{}';

create index if not exists itinerary_items_external_place_idx
  on itinerary_items(external_place_id)
  where external_place_id is not null;
