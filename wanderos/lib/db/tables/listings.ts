import { queryAurora } from "../pool";

/**
 * listings.repo — the ONLY module that touches the `listings` table (host domain).
 * Clean repository for the new host flow. Note: pg returns numeric as string, so price/lat/lng
 * are strings here; parse where a number is needed.
 */
export type ListingRow = {
  id: string;
  host_id: string;
  host_name?: string;
  title: string;
  description: string;
  city: string;
  country: string;
  category: string;
  price: string;
  bedrooms: number | null;
  bathrooms: number | null;
  max_guests: number | null;
  address: string | null;
  lat: string | null;
  lng: string | null;
  house_rules: string | null;
  amenities: string[];
  rooms: string[];
  quality_score: number | null;
  pricing_analysis: Record<string, unknown>;
  tags: string[];
  tour: Record<string, unknown>;
  details: Record<string, unknown>;
  image_url: string | null;
  status: string;
  moderation_status: string;
  created_at: string;
};

export type Comparable = { id: string; title: string; category: string; price: string; quality_score: number | null };

export type CreateListingInput = {
  id?: string; // optional: save under the crew's pre-generated listingId (so the embedding matches)
  hostId: string;
  title: string;
  description: string;
  city: string;
  country: string;
  category: string;
  price: number;
  bedrooms?: number;
  bathrooms?: number;
  maxGuests?: number;
  address?: string;
  lat?: number;
  lng?: number;
  houseRules?: string;
  amenities?: string[];
  rooms?: string[];
  qualityScore?: number;
  pricingAnalysis?: Record<string, unknown>;
  tags?: string[];
  tour?: Record<string, unknown>;
  imageUrl?: string;
  status?: "draft" | "published";
};

/** Insert a host-reviewed listing draft (transactional create). */
export async function createListing(input: CreateListingInput): Promise<ListingRow> {
  const rows = await queryAurora<ListingRow>(
    `insert into listings
       (id, host_id, title, description, city, country, category, price,
        bedrooms, bathrooms, max_guests, address, lat, lng, house_rules,
        amenities, rooms, quality_score, pricing_analysis, tags, tour, image_url,
        status, moderation_status)
     values (coalesce($1::uuid, gen_random_uuid()),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21::jsonb,$22,$23,'pending_review')
     returning *`,
    [
      input.id ?? null,
      input.hostId,
      input.title.trim(),
      input.description.trim(),
      input.city.trim(),
      input.country.trim(),
      input.category.trim(),
      input.price,
      input.bedrooms ?? null,
      input.bathrooms ?? null,
      input.maxGuests ?? null,
      input.address ?? null,
      input.lat ?? null,
      input.lng ?? null,
      input.houseRules ?? null,
      input.amenities ?? [],
      input.rooms ?? [],
      input.qualityScore ?? null,
      JSON.stringify(input.pricingAnalysis ?? {}),
      input.tags ?? [],
      JSON.stringify(input.tour ?? {}),
      input.imageUrl ?? null,
      input.status ?? "draft"
    ]
  );
  return rows[0];
}

/** Partial update of a listing's editable fields, scoped to its host (host can only edit their own). */
const UPDATABLE: Record<string, string> = {
  title: "title",
  description: "description",
  price: "price",
  bedrooms: "bedrooms",
  bathrooms: "bathrooms",
  maxGuests: "max_guests",
  amenities: "amenities",
  houseRules: "house_rules",
  tags: "tags",
  tour: "tour",
  status: "status"
};

export async function updateListing(id: string, hostId: string, patch: Record<string, unknown>): Promise<ListingRow | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [key, col] of Object.entries(UPDATABLE)) {
    if (patch[key] !== undefined) {
      const cast = col === "tour" ? "::jsonb" : "";
      vals.push(col === "tour" ? JSON.stringify(patch[key]) : patch[key]);
      sets.push(`${col} = $${vals.length}${cast}`);
    }
  }
  if (!sets.length) return getById(id);
  vals.push(id, hostId);
  const rows = await queryAurora<ListingRow>(
    `update listings set ${sets.join(", ")} where id = $${vals.length - 1} and host_id = $${vals.length} returning *`,
    vals
  );
  return rows[0] ?? null;
}

/**
 * Insert a placeholder DRAFT row at the start of the async flow (status='draft'). Idempotent on id:
 * a double-submit returns the existing draft instead of creating a second one. The crew fills it in
 * via applyDraftFields when the studio job completes.
 */
export async function insertDraft(input: {
  id: string;
  hostId: string;
  city: string;
  country: string;
  category: string;
  imageUrl?: string;
}): Promise<ListingRow> {
  const rows = await queryAurora<ListingRow>(
    `insert into listings (id, host_id, title, description, city, country, category, image_url, status, moderation_status)
     values ($1::uuid, $2, 'Generating your listing…', 'Your AI draft is being prepared…', $3, $4, $5, $6, 'draft', 'draft')
     on conflict (id) do nothing
     returning *`,
    [input.id, input.hostId, input.city.trim(), input.country.trim(), input.category.trim(), input.imageUrl ?? null]
  );
  return rows[0] ?? ((await getById(input.id)) as ListingRow);
}

/** Write the crew's draft fields into the listing row (worker call — not host-scoped). */
const DRAFT_FIELDS: Record<string, { col: string; jsonb?: boolean }> = {
  title: { col: "title" },
  description: { col: "description" },
  price: { col: "price" },
  bedrooms: { col: "bedrooms" },
  bathrooms: { col: "bathrooms" },
  maxGuests: { col: "max_guests" },
  amenities: { col: "amenities" },
  tags: { col: "tags" },
  houseRules: { col: "house_rules" },
  qualityScore: { col: "quality_score" },
  pricingAnalysis: { col: "pricing_analysis", jsonb: true },
  details: { col: "details", jsonb: true },
  imageUrl: { col: "image_url" }
};

export async function applyDraftFields(id: string, fields: Record<string, unknown>): Promise<ListingRow | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [key, spec] of Object.entries(DRAFT_FIELDS)) {
    if (fields[key] !== undefined) {
      vals.push(spec.jsonb ? JSON.stringify(fields[key]) : fields[key]);
      sets.push(`${spec.col} = $${vals.length}${spec.jsonb ? "::jsonb" : ""}`);
    }
  }
  if (!sets.length) return getById(id);
  vals.push(id);
  const rows = await queryAurora<ListingRow>(
    `update listings set ${sets.join(", ")} where id = $${vals.length} returning *`,
    vals
  );
  return rows[0] ?? null;
}

/** Lifecycle transition — set status (and optionally moderation_status), scoped to the owning host. */
export async function setStatus(
  id: string,
  hostId: string,
  status: string,
  moderationStatus?: string
): Promise<ListingRow | null> {
  const rows = await queryAurora<ListingRow>(
    `update listings set status = $3${moderationStatus ? ", moderation_status = $4" : ""}
     where id = $1 and host_id = $2 returning *`,
    moderationStatus ? [id, hostId, status, moderationStatus] : [id, hostId, status]
  );
  return rows[0] ?? null;
}

/** Admin-scoped status change (not host-scoped) — e.g. soft-delete a listing. */
export async function adminSetStatus(id: string, status: string): Promise<void> {
  await queryAurora(`update listings set status = $2, updated_at = now() where id = $1`, [id, status]);
}

/** Real admin dashboard stats from Aurora (counts + bookings + revenue). */
export async function adminStats(): Promise<{
  listings: number; pending: number; approved: number; rejected: number; hosts: number; bookings: number; revenue: number;
}> {
  const [l] = await queryAurora<{ listings: string; pending: string; approved: string; rejected: string }>(
    `select count(*) listings,
            count(*) filter (where moderation_status='pending_review') pending,
            count(*) filter (where moderation_status='approved') approved,
            count(*) filter (where moderation_status='rejected') rejected
     from listings where status <> 'deleted'`
  );
  const [h] = await queryAurora<{ hosts: string }>(`select count(*) hosts from users where role='host'`);
  const [b] = await queryAurora<{ bookings: string; revenue: string }>(`select count(*) bookings, coalesce(sum(total_amount),0) revenue from bookings`);
  return {
    listings: Number(l?.listings ?? 0), pending: Number(l?.pending ?? 0), approved: Number(l?.approved ?? 0), rejected: Number(l?.rejected ?? 0),
    hosts: Number(h?.hosts ?? 0), bookings: Number(b?.bookings ?? 0), revenue: Number(b?.revenue ?? 0)
  };
}

export async function getById(id: string): Promise<ListingRow | null> {
  const rows = await queryAurora<ListingRow>(`select * from listings where id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listByHost(hostId: string): Promise<ListingRow[]> {
  return queryAurora<ListingRow>(
    `select * from listings where host_id = $1 and status <> 'deleted' order by created_at desc`,
    [hostId]
  );
}

/** Approved listings for the public marketplace (with host name). */
export async function listPublic(): Promise<ListingRow[]> {
  return queryAurora<ListingRow>(
    `select l.*, u.name as host_name
     from listings l join users u on u.id = l.host_id
     where l.moderation_status = 'approved'
     order by l.created_at desc`
  );
}

/** Approved listings by id, preserving the input order where possible. Used by grounded RAG agents. */
export async function listApprovedByIds(ids: string[]): Promise<ListingRow[]> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return [];

  return queryAurora<ListingRow>(
    `select *
     from listings
     where id = any($1::uuid[])
       and moderation_status = 'approved'
       and status <> 'deleted'
     order by array_position($1::uuid[], id)`,
    [uniqueIds]
  );
}

/** Approved destination listings for real Aurora fallback when listing embeddings are sparse. */
export async function listApprovedForDestination(destination: string, limit = 8): Promise<ListingRow[]> {
  const needle = `%${destination.trim()}%`;
  return queryAurora<ListingRow>(
    `select *
     from listings
     where moderation_status = 'approved'
       and status <> 'deleted'
       and (
         lower(city) = lower($1)
         or lower(country) = lower($1)
         or lower($1) like '%' || lower(city) || '%'
         or lower($1) like '%' || lower(country) || '%'
         or lower(city) like lower($2)
       )
     order by quality_score desc nulls last, created_at desc
     limit $3`,
    [destination.trim(), needle, limit]
  );
}

/** Real comparable listings for the Pricing agent: same city + category, approved, priced. */
export async function getComparables(params: { city: string; category: string; limit?: number }): Promise<Comparable[]> {
  return queryAurora<Comparable>(
    `select id, title, category, price, quality_score
     from listings
     where moderation_status = 'approved' and price > 0
       and lower(city) = lower($1) and category = $2
     order by created_at desc
     limit $3`,
    [params.city, params.category, params.limit ?? 8]
  );
}

/** Broaden comp search: approved priced listings in the city across ANY category (used when same-category comps are too few). */
export async function getCityComparables(params: { city: string; limit?: number }): Promise<Comparable[]> {
  return queryAurora<Comparable>(
    `select id, title, category, price, quality_score
     from listings
     where moderation_status = 'approved' and price > 0 and lower(city) = lower($1)
     order by created_at desc
     limit $2`,
    [params.city, params.limit ?? 8]
  );
}

/** All listings for the admin moderation queue (pending first), with host name. */
export async function listForAdmin(): Promise<ListingRow[]> {
  return queryAurora<ListingRow>(
    `select l.*, u.name as host_name
     from listings l join users u on u.id = l.host_id
     order by case l.moderation_status when 'pending_review' then 0 when 'approved' then 1 else 2 end,
              l.created_at desc`
  );
}

export async function setModeration(id: string, status: "approved" | "rejected"): Promise<ListingRow | null> {
  const rows = await queryAurora<ListingRow>(
    `update listings set moderation_status = $2 where id = $1 returning *`,
    [id, status]
  );
  return rows[0] ?? null;
}
