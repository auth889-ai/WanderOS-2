-- 005_bookings.sql — short-stay booking fields (no Stripe; instant confirm).
-- The base bookings table (schema.sql) only had status/refs; add the stay details + amount.

alter table bookings add column if not exists check_in     date;
alter table bookings add column if not exists check_out    date;
alter table bookings add column if not exists guests       int     not null default 1;
alter table bookings add column if not exists nights       int     not null default 1;
alter table bookings add column if not exists total_amount numeric not null default 0;
alter table bookings add column if not exists currency     text    not null default 'AED';

create index if not exists bookings_traveler_idx on bookings (traveler_id, created_at desc);
create index if not exists bookings_host_idx     on bookings (host_id, created_at desc);
