import { queryAurora } from "../pool";

/**
 * trips.repo — the ONLY module that touches the `trips` / `trip_members` tables.
 */
export type TripRow = {
  id: string;
  traveler_id: string;
  title: string;
  destination: string;
  start_date: string | null;
  end_date: string | null;
  budget: string | null;
  travel_style: string | null;
  status: string;
  reality_prediction: Record<string, unknown>;
  profile: Record<string, unknown>;
  created_at: string;
};

export async function createTripDraft({
  travelerId,
  title,
  destination,
  startDate,
  endDate,
  budget,
  travelStyle
}: {
  travelerId: string;
  title: string;
  destination: string;
  startDate?: string;
  endDate?: string;
  budget?: number;
  travelStyle?: string;
}): Promise<TripRow> {
  const rows = await queryAurora<TripRow>(
    `insert into trips (traveler_id, title, destination, start_date, end_date, budget, travel_style, status)
     values ($1, $2, $3, nullif($4, '')::date, nullif($5, '')::date, $6, $7, 'draft')
     returning *`,
    [travelerId, title.trim(), destination.trim(), startDate || "", endDate || "", budget || 0, travelStyle || ""]
  );
  const trip = rows[0];

  await queryAurora(
    `insert into trip_members (trip_id, user_id, email, name, member_role, status, accepted_at)
     select $1, id, email, name, 'owner', 'accepted', now()
     from users where id = $2
     on conflict (trip_id, email) do nothing`,
    [trip.id, travelerId]
  );

  return trip;
}

export async function listTripsForUser(userId: string): Promise<TripRow[]> {
  return queryAurora<TripRow>(
    `select distinct t.*
     from trips t
     left join trip_members tm on tm.trip_id = t.id
     where t.traveler_id = $1 or tm.user_id = $1
     order by t.created_at desc`,
    [userId]
  );
}

export async function getTripForUser(tripId: string, userId: string): Promise<TripRow | null> {
  const rows = await queryAurora<TripRow>(
    `select t.*
     from trips t
     where t.id = $1
       and (
         t.traveler_id = $2
         or exists (
           select 1 from trip_members tm
           where tm.trip_id = t.id and tm.user_id = $2 and tm.status = 'accepted'
         )
       )
     limit 1`,
    [tripId, userId]
  );
  return rows[0] || null;
}

/**
 * Fetch a trip without a user check. Used by server-side board building, where
 * ownership has already been established by the caller.
 */
export async function getTripById(tripId: string): Promise<TripRow | null> {
  const rows = await queryAurora<TripRow>(
    `select * from trips where id = $1`,
    [tripId]
  );
  return rows[0] ?? null;
}

export async function updateTripProfile(tripId: string, profile: Record<string, unknown>): Promise<TripRow | null> {
  const rows = await queryAurora<TripRow>(
    `update trips
        set profile = $2::jsonb
      where id = $1
      returning *`,
    [tripId, JSON.stringify(profile)]
  );
  return rows[0] || null;
}

export async function setTripStatus(tripId: string, status: string): Promise<TripRow | null> {
  const rows = await queryAurora<TripRow>(
    `update trips
        set status = $2
      where id = $1
      returning *`,
    [tripId, status]
  );
  return rows[0] || null;
}
