import { queryAurora } from "../pool";

/**
 * The only module that touches listing_versions — the host's edit history. Every time the host saves
 * an edit, listing.service snapshots the full editable fields here, so the host can review past
 * versions (and we can restore). Supports the "host has full control, edit anytime" requirement.
 */
export type ListingVersionRow = {
  id: string;
  listing_id: string;
  version: number;
  snapshot: Record<string, unknown>;
  edited_by: string | null;
  note: string | null;
  created_at: string;
};

/** Append the next version snapshot (version = max+1, computed atomically). */
export async function saveVersion(params: {
  listingId: string;
  snapshot: Record<string, unknown>;
  editedBy?: string | null;
  note?: string;
}): Promise<ListingVersionRow> {
  const rows = await queryAurora<ListingVersionRow>(
    `insert into listing_versions (listing_id, version, snapshot, edited_by, note)
     values (
       $1,
       (select coalesce(max(version), 0) + 1 from listing_versions where listing_id = $1),
       $2::jsonb, $3, $4
     )
     returning *`,
    [params.listingId, JSON.stringify(params.snapshot), params.editedBy ?? null, params.note ?? null]
  );
  return rows[0];
}

/** All versions for a listing, newest first. */
export async function listVersions(listingId: string): Promise<ListingVersionRow[]> {
  return queryAurora<ListingVersionRow>(
    `select * from listing_versions where listing_id = $1 order by version desc`,
    [listingId]
  );
}

/** A specific version (for restore / diff). */
export async function getVersion(listingId: string, version: number): Promise<ListingVersionRow | null> {
  const rows = await queryAurora<ListingVersionRow>(
    `select * from listing_versions where listing_id = $1 and version = $2`,
    [listingId, version]
  );
  return rows[0] ?? null;
}
