import { queryAurora } from "../../pool";

/**
 * itinerary-days.repo - owns only the itinerary_days table.
 */

export type ItineraryDayRow = {
  id: string;
  trip_id: string;
  plan_version_id: string;
  day_number: number;
  date: string | null;
  theme: string | null;
  summary: string | null;
  area: string | null;
  created_at: string;
};

export type NewItineraryDay = {
  dayNumber: number;
  date?: string | null;
  theme?: string | null;
  summary?: string | null;
  area?: string | null;
};

export async function saveItineraryDays(params: {
  tripId: string;
  planVersionId: string;
  days: NewItineraryDay[];
}): Promise<ItineraryDayRow[]> {
  const saved: ItineraryDayRow[] = [];

  for (const day of params.days) {
    const rows = await queryAurora<ItineraryDayRow>(
      `insert into itinerary_days (trip_id, plan_version_id, day_number, date, theme, summary, area)
       values ($1, $2, $3, nullif($4, '')::date, $5, $6, $7)
       returning *`,
      [
        params.tripId,
        params.planVersionId,
        day.dayNumber,
        day.date ?? "",
        day.theme ?? null,
        day.summary ?? null,
        day.area ?? null
      ]
    );
    saved.push(rows[0]);
  }

  return saved;
}

export async function listItineraryDays(planVersionId: string): Promise<ItineraryDayRow[]> {
  return queryAurora<ItineraryDayRow>(
    `select *
       from itinerary_days
      where plan_version_id = $1
      order by day_number asc`,
    [planVersionId]
  );
}
