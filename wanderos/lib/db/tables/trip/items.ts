import { queryAurora } from "../../pool";

/**
 * itinerary-items.repo - owns only the itinerary_items table.
 */

export type ItineraryItemRow = {
  id: string;
  trip_id: string;
  day_number: number;
  time_label: string | null;
  title: string;
  description: string | null;
  category: string | null;
  source: string;
  plan_version_id: string | null;
  est_cost: string;
  locked: boolean;
  stay_listing_id: string | null;
  place_name: string | null;
  place_address: string | null;
  place_url: string | null;
  external_place_id: string | null;
  place_rating: string | null;
  image_url: string | null;
  image_attribution: Record<string, unknown>;
  selection_rationale: string | null;
  timing_rationale: string | null;
  cost_source: string | null;
  cost_rationale: string | null;
  metadata: Record<string, unknown>;
};

export type NewItineraryItem = {
  dayNumber: number;
  timeLabel?: string | null;
  title: string;
  description?: string | null;
  category?: string | null;
  source?: string;
  estCost?: number;
  locked?: boolean;
  stayListingId?: string | null;
  placeName?: string | null;
  placeAddress?: string | null;
  placeUrl?: string | null;
  externalPlaceId?: string | null;
  placeRating?: number | null;
  imageUrl?: string | null;
  imageAttribution?: Record<string, unknown>;
  selectionRationale?: string | null;
  timingRationale?: string | null;
  costSource?: string | null;
  costRationale?: string | null;
  metadata?: Record<string, unknown>;
};

export async function saveItineraryItems(params: {
  tripId: string;
  planVersionId: string;
  items: NewItineraryItem[];
}): Promise<ItineraryItemRow[]> {
  const saved: ItineraryItemRow[] = [];

  for (const item of params.items) {
    const rows = await queryAurora<ItineraryItemRow>(
      `insert into itinerary_items (
         trip_id,
         plan_version_id,
         day_number,
         time_label,
         title,
         description,
         category,
         source,
         est_cost,
         locked,
         stay_listing_id,
         place_name,
         place_address,
         place_url,
         external_place_id,
         place_rating,
         image_url,
         image_attribution,
         selection_rationale,
         timing_rationale,
         cost_source,
         cost_rationale,
         metadata
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19, $20, $21, $22, $23::jsonb)
       returning *`,
      [
        params.tripId,
        params.planVersionId,
        item.dayNumber,
        item.timeLabel ?? null,
        item.title.trim(),
        item.description ?? null,
        item.category ?? null,
        item.source ?? "agent",
        item.estCost ?? 0,
        item.locked ?? false,
        item.stayListingId ?? null,
        item.placeName ?? null,
        item.placeAddress ?? null,
        item.placeUrl ?? null,
        item.externalPlaceId ?? null,
        item.placeRating ?? null,
        item.imageUrl ?? null,
        JSON.stringify(item.imageAttribution ?? {}),
        item.selectionRationale ?? null,
        item.timingRationale ?? null,
        item.costSource ?? null,
        item.costRationale ?? null,
        JSON.stringify(item.metadata ?? {})
      ]
    );
    saved.push(rows[0]);
  }

  return saved;
}

export async function listItineraryItems(planVersionId: string): Promise<ItineraryItemRow[]> {
  return queryAurora<ItineraryItemRow>(
    `select *
       from itinerary_items
      where plan_version_id = $1
      order by day_number asc, time_label asc nulls last, id asc`,
    [planVersionId]
  );
}

export async function getItineraryItemForTrip(tripId: string, itemId: string): Promise<ItineraryItemRow | null> {
  const rows = await queryAurora<ItineraryItemRow>(
    `select *
       from itinerary_items
      where trip_id = $1 and id = $2
      limit 1`,
    [tripId, itemId]
  );
  return rows[0] ?? null;
}

export async function createItineraryItem(params: {
  tripId: string;
  planVersionId: string;
  item: NewItineraryItem;
}): Promise<ItineraryItemRow> {
  const rows = await saveItineraryItems({
    tripId: params.tripId,
    planVersionId: params.planVersionId,
    items: [params.item]
  });
  return rows[0];
}

export async function lockItineraryItem(itemId: string, locked: boolean): Promise<ItineraryItemRow | null> {
  const rows = await queryAurora<ItineraryItemRow>(
    `update itinerary_items
        set locked = $2
      where id = $1
      returning *`,
    [itemId, locked]
  );
  return rows[0] ?? null;
}

export type ItineraryItemPatch = {
  dayNumber?: number;
  timeLabel?: string | null;
  title?: string;
  description?: string | null;
  category?: string | null;
  estCost?: number;
  locked?: boolean;
  stayListingId?: string | null;
  placeName?: string | null;
  placeAddress?: string | null;
  placeUrl?: string | null;
  externalPlaceId?: string | null;
  placeRating?: number | null;
  imageUrl?: string | null;
  imageAttribution?: Record<string, unknown>;
  selectionRationale?: string | null;
  timingRationale?: string | null;
  costSource?: string | null;
  costRationale?: string | null;
  metadata?: Record<string, unknown>;
};

export async function editItineraryItem(itemId: string, patch: ItineraryItemPatch): Promise<ItineraryItemRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [itemId];

  function addSet(column: string, value: unknown) {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  }

  if ("dayNumber" in patch) addSet("day_number", patch.dayNumber);
  if ("timeLabel" in patch) addSet("time_label", patch.timeLabel);
  if ("title" in patch) addSet("title", patch.title?.trim());
  if ("description" in patch) addSet("description", patch.description);
  if ("category" in patch) addSet("category", patch.category);
  if ("estCost" in patch) addSet("est_cost", patch.estCost);
  if ("locked" in patch) addSet("locked", patch.locked);
  if ("stayListingId" in patch) addSet("stay_listing_id", patch.stayListingId);
  if ("placeName" in patch) addSet("place_name", patch.placeName);
  if ("placeAddress" in patch) addSet("place_address", patch.placeAddress);
  if ("placeUrl" in patch) addSet("place_url", patch.placeUrl);
  if ("externalPlaceId" in patch) addSet("external_place_id", patch.externalPlaceId);
  if ("placeRating" in patch) addSet("place_rating", patch.placeRating);
  if ("imageUrl" in patch) addSet("image_url", patch.imageUrl);
  if ("imageAttribution" in patch) addSet("image_attribution", JSON.stringify(patch.imageAttribution ?? {}));
  if ("selectionRationale" in patch) addSet("selection_rationale", patch.selectionRationale);
  if ("timingRationale" in patch) addSet("timing_rationale", patch.timingRationale);
  if ("costSource" in patch) addSet("cost_source", patch.costSource);
  if ("costRationale" in patch) addSet("cost_rationale", patch.costRationale);
  if ("metadata" in patch) addSet("metadata", JSON.stringify(patch.metadata ?? {}));

  if (!sets.length) {
    const rows = await queryAurora<ItineraryItemRow>(`select * from itinerary_items where id = $1`, [itemId]);
    return rows[0] ?? null;
  }

  const rows = await queryAurora<ItineraryItemRow>(
    `update itinerary_items
        set ${sets.join(", ")}
      where id = $1
      returning *`,
    values
  );

  return rows[0] ?? null;
}

export async function deleteItineraryItem(itemId: string): Promise<ItineraryItemRow | null> {
  const rows = await queryAurora<ItineraryItemRow>(
    `delete from itinerary_items
      where id = $1
      returning *`,
    [itemId]
  );
  return rows[0] ?? null;
}
