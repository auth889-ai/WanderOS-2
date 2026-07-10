import { queryAurora } from "../pool";

/**
 * listingMedia.repo — the ONLY module that touches the `listing_media` table.
 * The listing's photo/video gallery. Both listing creation (save photos) and the
 * listing-video crew (read photos to animate) go through here.
 */
export type ListingMediaRow = {
  id: string;
  listing_id: string;
  url: string;
  type: string;
  caption: string | null;
  detected_room: string | null;
  enhanced_url: string | null;
  is_enhanced: boolean;
  sort_order: number;
  created_at: string;
};

export type NewMedia = {
  url: string;
  type?: "image" | "video";
  caption?: string;
  detectedRoom?: string;
};

/** Insert N media items for a listing in one statement, preserving order. */
export async function insertMany(listingId: string, items: NewMedia[]): Promise<ListingMediaRow[]> {
  if (!items.length) return [];

  const values: unknown[] = [];
  const tuples = items.map((m, i) => {
    const b = i * 5;
    values.push(listingId, m.url, m.type ?? "image", m.caption ?? null, m.detectedRoom ?? null);
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, ${i})`;
  });

  return queryAurora<ListingMediaRow>(
    `insert into listing_media (listing_id, url, type, caption, detected_room, sort_order)
     values ${tuples.join(", ")}
     returning *`,
    values
  );
}

/** All media for a listing, in display order. */
export async function listByListing(listingId: string): Promise<ListingMediaRow[]> {
  return queryAurora<ListingMediaRow>(
    `select * from listing_media where listing_id = $1 order by sort_order asc, created_at asc`,
    [listingId]
  );
}

/** Just the image URLs for a listing (used by the video crew). */
export async function imageUrls(listingId: string): Promise<string[]> {
  const rows = await queryAurora<{ url: string }>(
    `select url from listing_media where listing_id = $1 and type = 'image' order by sort_order asc`,
    [listingId]
  );
  return rows.map((r) => r.url);
}
