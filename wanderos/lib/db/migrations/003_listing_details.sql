-- 003_listing_details.sql (P4) — persist the premium Airbnb-grade detailer output on the listing,
-- so the marketplace detail page (P12) renders room breakdown / highlights / amenity groups / location.
alter table listings add column if not exists details jsonb not null default '{}';
