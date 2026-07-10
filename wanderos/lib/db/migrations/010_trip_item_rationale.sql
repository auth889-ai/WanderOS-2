-- 010_trip_item_rationale.sql — explain why an itinerary item exists, not only what it is.

alter table itinerary_items
  add column if not exists selection_rationale text,
  add column if not exists timing_rationale text;
