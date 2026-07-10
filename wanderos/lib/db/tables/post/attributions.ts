import { queryAurora } from "../../pool";

/**
 * post_booking_attributions.repo - traces feed commerce clicks and bookings back to posts.
 */
export type PostAttributionType = "click" | "booking";

export type PostBookingAttributionRow = {
  id: string;
  post_id: string;
  viewer_id: string | null;
  listing_id: string | null;
  booking_id: string | null;
  attribution_type: PostAttributionType;
  created_at: string;
};

export async function recordPostAttribution(input: {
  postId: string;
  viewerId?: string | null;
  listingId?: string | null;
  bookingId?: string | null;
  attributionType: PostAttributionType;
}): Promise<PostBookingAttributionRow> {
  const rows = await queryAurora<PostBookingAttributionRow>(
    `insert into post_booking_attributions
       (post_id, viewer_id, listing_id, booking_id, attribution_type)
     values ($1,$2,$3,$4,$5)
     returning *`,
    [
      input.postId,
      input.viewerId ?? null,
      input.listingId ?? null,
      input.bookingId ?? null,
      input.attributionType
    ]
  );
  return rows[0];
}

export async function listPostAttributions(postId: string): Promise<PostBookingAttributionRow[]> {
  return queryAurora<PostBookingAttributionRow>(
    `select *
       from post_booking_attributions
      where post_id = $1
      order by created_at desc`,
    [postId]
  );
}
