import { queryAurora } from "../pool";

/**
 * bookings.repo — the ONLY module that touches the `bookings` table.
 */
export type BookingRow = {
  id: string;
  trip_id: string | null;
  listing_id: string | null;
  traveler_id: string;
  host_id: string;
  status: string;
  created_at: string;
};

export async function createBookingRequest({
  travelerId,
  listingId,
  tripId
}: {
  travelerId: string;
  listingId: string;
  tripId?: string;
}): Promise<BookingRow | null> {
  const rows = await queryAurora<BookingRow>(
    `insert into bookings (trip_id, listing_id, traveler_id, host_id, status)
     select nullif($1, '')::uuid, l.id, $2, l.host_id, 'requested'
     from listings l
     where l.id = $3
       and l.moderation_status = 'approved'
       and l.host_id <> $2
     returning *`,
    [tripId || "", travelerId, listingId]
  );
  return rows[0] || null;
}

export async function listBookingsForTraveler(travelerId: string): Promise<BookingRow[]> {
  return queryAurora<BookingRow>(
    `select * from bookings where traveler_id = $1 order by created_at desc`,
    [travelerId]
  );
}

export async function listBookingsForHost(hostId: string): Promise<BookingRow[]> {
  return queryAurora<BookingRow>(
    `select * from bookings where host_id = $1 order by created_at desc`,
    [hostId]
  );
}
