import { getUpcomingHolidays, type HolidayHit } from "@/lib/tools/travel/holidays";
import { searchPlaces } from "@/lib/tools/travel/places";
import { getHolidayConcierge } from "./agents/holiday-concierge/agent";

export type ConciergeDestination = { name: string; why: string; photoUrl?: string; rating?: number };
export type HolidayPlan = {
  holiday: string; date: string; daysLeft: number; longWeekend: boolean;
  overview: string; whatToDo: string[]; traditions: string[]; bestDestinations: ConciergeDestination[]; travelTip: string;
};

export async function listUpcomingHolidays(country: string): Promise<HolidayHit[]> {
  return getUpcomingHolidays(country);
}

/** The holiday concierge: for a given holiday, "what can I do + where to go" with photo-enriched destinations. */
export async function planHoliday(opts: { countryName: string; country: string; holiday: string; date: string; daysLeft: number; longWeekend: boolean; budget?: string; interests?: string[] }): Promise<HolidayPlan> {
  const plan = await getHolidayConcierge({ country: opts.countryName, holiday: opts.holiday, date: opts.date, daysLeft: opts.daysLeft, longWeekend: opts.longWeekend, budget: opts.budget, interests: opts.interests });
  const bestDestinations = await Promise.all(plan.bestDestinations.map(async (d) => {
    const found = await searchPlaces(`${d.name} ${opts.countryName}`, 1).catch(() => []);
    return { name: d.name, why: d.why, photoUrl: found[0]?.photoUrl, rating: found[0]?.rating };
  }));
  return { holiday: opts.holiday, date: opts.date, daysLeft: opts.daysLeft, longWeekend: opts.longWeekend, overview: plan.overview, whatToDo: plan.whatToDo, traditions: plan.traditions, bestDestinations, travelTip: plan.travelTip };
}
