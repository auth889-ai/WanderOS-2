import { queryAurora } from "@/lib/db/pool";

/**
 * post-trust.service - deterministic trust checks for social-commerce posts.
 * AI and requests can suggest booking/listing links, but only this service can decide Verified Stay.
 */
export type VerifiedStayResult = {
  verified: boolean;
  reason: string;
  listingId?: string;
  bookingId?: string;
};

export async function verifyStayForPost(input: {
  authorId: string;
  listingId?: string | null;
  bookingId?: string | null;
}): Promise<VerifiedStayResult> {
  if (!input.listingId || !input.bookingId) {
    return { verified: false, reason: "missing_listing_or_booking" };
  }

  const rows = await queryAurora<{
    booking_id: string;
    listing_id: string;
    traveler_id: string;
    booking_status: string;
    listing_status: string;
    moderation_status: string;
  }>(
    `select b.id as booking_id,
            b.listing_id,
            b.traveler_id,
            b.status as booking_status,
            l.status as listing_status,
            l.moderation_status
       from bookings b
       join listings l on l.id = b.listing_id
      where b.id = $1
        and b.listing_id = $2
      limit 1`,
    [input.bookingId, input.listingId]
  );

  const row = rows[0];
  if (!row) return { verified: false, reason: "booking_listing_mismatch" };
  if (row.traveler_id !== input.authorId) return { verified: false, reason: "booking_not_owned_by_author" };
  if (!["confirmed", "completed", "approved"].includes(row.booking_status)) {
    return { verified: false, reason: "booking_not_confirmed" };
  }
  if (row.moderation_status !== "approved" || row.listing_status === "deleted") {
    return { verified: false, reason: "listing_not_public" };
  }

  return {
    verified: true,
    reason: "verified_booking_and_listing",
    listingId: row.listing_id,
    bookingId: row.booking_id
  };
}

export async function canUseListingCta(listingId?: string | null): Promise<boolean> {
  if (!listingId) return false;
  const rows = await queryAurora<{ id: string }>(
    `select id
       from listings
      where id = $1
        and moderation_status = 'approved'
        and status <> 'deleted'
      limit 1`,
    [listingId]
  );
  return Boolean(rows[0]);
}
