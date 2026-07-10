import { queryAurora } from "@/lib/db/pool";
import { getById } from "@/lib/db/tables/listings";

/** Booking commit layer — instant confirm (no payment rail). Total = nights × nightly price, stored in Aurora. */
export interface BookingRow {
  id: string;
  listing_id: string;
  traveler_id: string;
  host_id: string;
  check_in: string | null;
  check_out: string | null;
  guests: number;
  nights: number;
  total_amount: string;
  currency: string;
  status: string;
  created_at: string;
}

export async function createBooking(
  travelerId: string,
  input: { listingId: string; checkIn: string; checkOut: string; guests: number }
): Promise<{ ok: boolean; error?: string; booking?: BookingRow }> {
  const listing = await getById(input.listingId).catch(() => null);
  if (!listing || listing.moderation_status !== "approved") return { ok: false, error: "this listing is not available to book" };
  if (listing.host_id === travelerId) return { ok: false, error: "you can't book your own listing" };

  const ci = new Date(input.checkIn);
  const co = new Date(input.checkOut);
  const nights = Math.round((co.getTime() - ci.getTime()) / 86_400_000);
  if (!input.checkIn || !input.checkOut || Number.isNaN(nights) || nights < 1) {
    return { ok: false, error: "check-out must be at least one night after check-in" };
  }
  const guests = Math.max(1, Math.min(input.guests || 1, listing.max_guests || 1));
  const total = nights * Number(listing.price);

  const [booking] = await queryAurora<BookingRow>(
    `insert into bookings (listing_id, traveler_id, host_id, check_in, check_out, guests, nights, total_amount, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'confirmed') returning *`,
    [input.listingId, travelerId, listing.host_id, input.checkIn, input.checkOut, guests, nights, total]
  );
  return { ok: true, booking };
}

export async function listTravelerBookings(travelerId: string): Promise<(BookingRow & { title: string; city: string; image_url: string | null })[]> {
  return queryAurora(
    `select b.*, l.title, l.city, l.image_url from bookings b join listings l on l.id = b.listing_id where b.traveler_id = $1 order by b.created_at desc`,
    [travelerId]
  );
}

export async function listHostBookings(hostId: string): Promise<(BookingRow & { title: string; city: string | null; traveler_name: string | null })[]> {
  return queryAurora(
    `select b.*, l.title, l.city, u.name as traveler_name
       from bookings b
       join listings l on l.id = b.listing_id
       left join users u on u.id = b.traveler_id
      where b.host_id = $1 order by b.created_at desc`,
    [hostId]
  );
}

export async function hostEarnings(hostId: string): Promise<number> {
  const [r] = await queryAurora<{ sum: string }>(`select coalesce(sum(total_amount),0) as sum from bookings where host_id = $1`, [hostId]);
  return Number(r?.sum ?? 0);
}

export type EarningsSummary = {
  total: number;
  bookingCount: number;
  nights: number;
  guests: number;
  monthly: { month: string; amount: number; bookings: number }[];
  byListing: { title: string; amount: number; bookings: number }[];
};

/** Host earnings dashboard data — totals + monthly series (for the graph) + per-listing breakdown. */
export async function hostEarningsSummary(hostId: string): Promise<EarningsSummary> {
  const [tot] = await queryAurora<{ sum: string; cnt: string; nights: string; guests: string }>(
    `select coalesce(sum(total_amount),0) sum, count(*) cnt, coalesce(sum(nights),0) nights, coalesce(sum(guests),0) guests
       from bookings where host_id = $1`,
    [hostId]
  );
  const monthly = await queryAurora<{ mlabel: string; amount: string; bookings: string }>(
    `select to_char(date_trunc('month', created_at), 'Mon') as mlabel, sum(total_amount) as amount, count(*) as bookings
       from bookings where host_id = $1
      group by date_trunc('month', created_at)
      order by date_trunc('month', created_at) asc
      limit 12`,
    [hostId]
  );
  const byListing = await queryAurora<{ title: string; amount: string; bookings: string }>(
    `select l.title, sum(b.total_amount) amount, count(*) bookings
       from bookings b join listings l on l.id = b.listing_id
      where b.host_id = $1 group by l.title order by sum(b.total_amount) desc limit 6`,
    [hostId]
  );
  return {
    total: Number(tot?.sum ?? 0),
    bookingCount: Number(tot?.cnt ?? 0),
    nights: Number(tot?.nights ?? 0),
    guests: Number(tot?.guests ?? 0),
    monthly: monthly.map((m) => ({ month: m.mlabel, amount: Number(m.amount), bookings: Number(m.bookings) })),
    byListing: byListing.map((r) => ({ title: r.title, amount: Number(r.amount), bookings: Number(r.bookings) }))
  };
}
