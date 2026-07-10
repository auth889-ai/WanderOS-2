import { queryAurora } from "../pool";

export type TravelProfile = { budget: string | null; interests: string[]; home_country: string | null; last_query: string | null };

export async function getTravelProfile(userId: string): Promise<TravelProfile | null> {
  const rows = await queryAurora<TravelProfile>(`select budget, interests, home_country, last_query from travel_profiles where user_id = $1`, [userId]);
  return rows[0] ?? null;
}

export async function saveTravelProfile(userId: string, p: { budget?: string | null; interests?: string[]; homeCountry?: string | null; lastQuery?: string | null }): Promise<void> {
  await queryAurora(
    `insert into travel_profiles (user_id, budget, interests, home_country, last_query, updated_at)
     values ($1, $2, $3::jsonb, $4, $5, now())
     on conflict (user_id) do update set
       budget = coalesce(excluded.budget, travel_profiles.budget),
       interests = coalesce(excluded.interests, travel_profiles.interests),
       home_country = coalesce(excluded.home_country, travel_profiles.home_country),
       last_query = coalesce(excluded.last_query, travel_profiles.last_query),
       updated_at = now()`,
    [userId, p.budget ?? null, JSON.stringify(p.interests ?? []), p.homeCountry ?? null, p.lastQuery ?? null]
  );
}
