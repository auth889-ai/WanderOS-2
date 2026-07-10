import { queryAurora } from "@/lib/db/pool";
import { TravelIntelInputSchema } from "./schemas";
import { resolveDestination } from "./agents/destination-resolver/agent";
import { suggestDestinations } from "./agents/destination-suggester/agent";
import { composeTravelCards } from "./agents/card-composer/agent";
import { predictExperience } from "./agents/predictor/agent";
import { scoreMatches } from "./agents/match-scorer/agent";
import { getUpcomingHolidays, type HolidayHit } from "@/lib/tools/travel/holidays";
import { geocode, searchPlaces, type Place } from "@/lib/tools/travel/places";
import { findEvents, type EventItem } from "@/lib/tools/travel/events";
import { getWeather, type WeatherOutlook } from "@/lib/tools/travel/weather";
import { getHeroImage } from "@/lib/tools/travel/images";
import { getCountryFacts, type CountryFacts } from "@/lib/tools/travel/country";
import { getExchange } from "@/lib/tools/travel/exchange";
import { getWikiSummary } from "@/lib/tools/travel/wiki";
import { getCultureTips } from "./agents/culture-tips/agent";
import { getDateWindowPlan } from "./agents/date-window/agent";
import { planBudget } from "./agents/budget-planner/agent";
import type { BudgetBreakdownResult } from "./agents/budget-planner/schema";
import { retrieve, toGroundedContext } from "@/lib/agents/tools/pgvector-retriever.tool";
import type { TravelCardResult } from "./agents/card-composer/schema";
import type { PredictorResult } from "./agents/predictor/schema";
import type { CultureTipsResult } from "./agents/culture-tips/schema";

export type StayHit = { id: string; title: string; city: string; price: string; image_url: string | null };
export type SuggestedTrip = { destination: string; why: string; days?: string; score?: number; matchReason?: string };
export type ScoredPlace = Place & { score?: number; matchReason?: string };

export type TravelIntel = {
  mode: "place" | "suggest";
  destination: string; country: string; city: string;
  heroImage: string | null;
  cultureTips: CultureTipsResult | null;
  countryFacts: CountryFacts | null;
  exchange: { from: string; to: string; rate: number } | null;
  wiki: { extract: string; thumbnail: string | null } | null;
  dateWindow: { from: string; to: string; seasonNote: string; tips: string; festivalsInRange: string[]; bestPlaces: { name: string; why: string; photoUrl?: string; rating?: number; address?: string }[] } | null;
  budgetPlan: BudgetBreakdownResult | null;
  memories: { content: string; type: string; similarity: number }[];
  holidays: HolidayHit[];
  attractions: ScoredPlace[];
  food: Place[];
  festivalPlaces: Place[];
  events: EventItem[];
  weather: WeatherOutlook | null;
  stays: StayHit[];
  suggestedTrips: SuggestedTrip[];
  cards: TravelCardResult;
  prediction: PredictorResult | null;
};

const COUNTRY_NAME: Record<string, string> = { BD: "Bangladesh", IN: "India", PK: "Pakistan", LK: "Sri Lanka", NP: "Nepal", TH: "Thailand", JP: "Japan", AE: "United Arab Emirates", MY: "Malaysia", ID: "Indonesia" };

async function findStays(city: string): Promise<StayHit[]> {
  if (!city) return [];
  try {
    return await queryAurora<StayHit>(
      `select id, title, city, price, image_url from listings
        where status = 'published' and city ilike $1 order by created_at desc limit 6`,
      [`%${city.split(",")[0].trim()}%`]
    );
  } catch { return []; }
}

/**
 * Travel Intelligence crew (features 1·2·5). Two modes:
 *  - PLACE: a city is given → real holidays · attractions · festivals · events · weather · stays + AI cards + prediction.
 *  - SUGGEST: only a country/budget → detect upcoming holidays → AI suggests REAL destinations to visit for that holiday.
 */
export async function runTravelIntel(input: unknown): Promise<TravelIntel> {
  const data = TravelIntelInputSchema.parse(input);
  const resolved = await resolveDestination(data.query).catch(() => ({ destination: data.query, interests: [] as string[], travelStyle: undefined, budget: undefined, dateFrom: undefined, dateTo: undefined }));
  const place = resolved.destination || data.query;
  const interests = [...new Set([...(data.interests ?? []), ...resolved.interests])];
  // natural-language fallback: pull budget + dates from the sentence if the form didn't supply them
  const budget = data.budget || resolved.budget;
  const dateFrom = data.dateFrom || resolved.dateFrom;
  const dateTo = data.dateTo || resolved.dateTo;

  const geo = await geocode(place);
  const country = (data.country || geo?.country || "").toUpperCase();
  const cityLevel = !!geo && geo.formatted.includes(","); // a real city geocode has "City, …"; a country is just "Bangladesh"
  const suggestMode = !resolved.destination || !cityLevel;

  // ---------- SUGGEST MODE: holiday-driven destination discovery ----------
  if (suggestMode) {
    const holidays = country ? await getUpcomingHolidays(country) : [];
    const soonest = holidays[0];
    const countryName = COUNTRY_NAME[country] || geo?.formatted || country || "your area";
    const sug = await suggestDestinations({
      country: countryName,
      soonestHoliday: soonest ? soonest.name : undefined,
      daysLeft: soonest?.daysLeft,
      budget: budget, interests
    }).catch(() => ({ trips: [] as SuggestedTrip[] }));

    // personalization: score + rank each suggested trip to THIS traveler (like a job fit-score)
    let scoredTrips: SuggestedTrip[] = sug.trips;
    try {
      const ms = await scoreMatches({ profile: { budget: budget, interests, travelStyle: resolved.travelStyle }, candidates: sug.trips.map((t) => ({ name: t.destination, kind: "destination", hint: t.why })) });
      const m = new Map(ms.scored.map((s) => [s.name, s]));
      scoredTrips = sug.trips.map((t) => ({ ...t, score: m.get(t.destination)?.score, matchReason: m.get(t.destination)?.reason })).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    } catch { /* keep unscored */ }

    const triggers = soonest
      ? [{ title: `${soonest.name} in ${soonest.daysLeft} days`, body: `You have a travel window${soonest.longWeekend ? " (long weekend)" : ""}. ${sug.trips[0] ? `${sug.trips[0].destination} is a strong match for your budget — ${sug.trips[0].why}` : "Pick a destination below to plan."}` }]
      : [];
    const facts = getCountryFacts(country);
    const [heroImage, exchange, wiki] = await Promise.all([
      getHeroImage(countryName).catch(() => null),
      getExchange(facts?.currencyCode).catch(() => null),
      getWikiSummary(countryName).catch(() => null)
    ]);
    return {
      mode: "suggest", destination: place, country: countryName, city: countryName,
      heroImage, cultureTips: null, countryFacts: facts, exchange, wiki, dateWindow: null, budgetPlan: null, memories: [],
      holidays, attractions: [], food: [], festivalPlaces: [], events: [], weather: null, stays: [],
      suggestedTrips: scoredTrips,
      cards: { summary: soonest ? `${holidays.length} holidays are coming up in ${countryName}. The soonest is ${soonest.name} in ${soonest.daysLeft} days — here are real trips that fit your budget.` : `Pick a destination to get full intelligence, or set a country to see holiday-driven trip ideas.`, triggers, festivals: holidays.slice(0, 5).map((h) => ({ name: h.name, when: `in ${h.daysLeft}d`, why: h.types[0] || "Public holiday — a chance to travel." })) },
      prediction: null
    };
  }

  // ---------- PLACE MODE: full destination intelligence ----------
  const city = geo!.city;
  const [holidays, attractions, food, festivalPlaces, events, weather, stays, heroImage, wiki] = await Promise.all([
    country ? getUpcomingHolidays(country) : Promise.resolve([]),
    searchPlaces(`top tourist attractions in ${city}`, 12),
    searchPlaces(`best local food restaurants in ${city}`, 9),
    searchPlaces(`mela fair exhibition cultural festival ground in ${city}`, 8),
    findEvents(city, geo!.lat, geo!.lng),
    getWeather(geo!.lat, geo!.lng),
    findStays(city),
    getHeroImage(city).catch(() => null),
    getWikiSummary(city).catch(() => null)
  ]);
  const countryFacts = getCountryFacts(country);
  const exchange = await getExchange(countryFacts?.currencyCode).catch(() => null);

  // date-range intelligence: "from X to Y, which festivals + best places (season-aware)"
  let dateWindow: TravelIntel["dateWindow"] = null;
  if (dateFrom && dateTo) {
    const inRange = holidays.filter((h) => h.date >= dateFrom! && h.date <= dateTo!).map((h) => `${h.name} (${h.date})`);
    const plan = await getDateWindowPlan({
      destination: city, country, dateFrom: dateFrom, dateTo: dateTo,
      weather: weather?.summary, attractions: attractions.map((a) => a.name), festivalsInRange: inRange, interests
    }).catch(() => null);
    if (plan) {
      // enrich each AI-recommended iconic place with a REAL Google Places photo + rating + maps
      const enriched = await Promise.all(plan.bestPlaces.map(async (b) => {
        const found = await searchPlaces(`${b.name} ${city}`, 1).catch(() => []);
        const f = found[0];
        return { name: b.name, why: b.why, photoUrl: f?.photoUrl, rating: f?.rating, address: f?.address };
      }));
      dateWindow = { from: dateFrom, to: dateTo, seasonNote: plan.seasonNote, tips: plan.tips, festivalsInRange: inRange, bestPlaces: enriched };
    }
  }
  // RAG (pgvector): recall the traveler's own relevant memories — past posts/trips/saved research
  let memories: TravelIntel["memories"] = [];
  let ragContext = "";
  if (data.userId) {
    const hits = await retrieve({ query: `${city} ${interests.join(" ")}`, ownerTypes: ["post", "trip", "memory", "research"], userId: data.userId, limit: 4 }).catch(() => []);
    const relevant = hits.filter((h) => h.similarity > 0.42);
    memories = relevant.map((h) => ({ content: h.content.slice(0, 200), type: h.owner_type, similarity: Math.round(h.similarity * 100) / 100 }));
    ragContext = toGroundedContext(relevant).context;
  }

  // budget breakdown — make the budget PRODUCTIVE (grounded in real stay prices + RAG memory)
  let budgetPlan: BudgetBreakdownResult | null = null;
  if (budget) {
    budgetPlan = await planBudget({ destination: city, budget, currency: countryFacts?.currencyCode, stays: stays.map((s) => ({ title: s.title, price: `৳${s.price}` })), interests, ragContext: ragContext || undefined }).catch(() => null);
  }

  const soonest = holidays[0];
  const avgRating = attractions.length ? attractions.reduce((s, a) => s + (a.rating ?? 0), 0) / attractions.length : undefined;

  const [cards, prediction, attrScores, cultureTips] = await Promise.all([
    composeTravelCards({
      destination: city, country, budget: budget, interests,
      holidays, events,
      festivalPlaces: festivalPlaces.map((p) => ({ name: p.name })),
      attractions: attractions.map((a) => ({ name: a.name, rating: a.rating })),
      stays: stays.map((s) => ({ title: s.title, city: s.city, price: s.price }))
    }),
    predictExperience({
      destination: city, weather: weather?.summary,
      holidayOverlap: !!soonest && soonest.daysLeft <= 30,
      soonestHoliday: soonest ? `${soonest.name} in ${soonest.daysLeft}d` : undefined,
      avgRating: avgRating ? Math.round(avgRating * 10) / 10 : undefined,
      interests
    }),
    scoreMatches({ profile: { budget: budget, interests, travelStyle: resolved.travelStyle }, candidates: attractions.map((a) => ({ name: a.name, kind: "attraction", hint: a.rating ? `rated ${a.rating}` : undefined })) }).catch(() => ({ scored: [] })),
    getCultureTips(city, country, weather?.summary).catch(() => null)
  ]);

  // personalization: rank attractions by fit to THIS traveler
  const sMap = new Map(attrScores.scored.map((s) => [s.name, s]));
  const scoredAttractions: ScoredPlace[] = attractions
    .map((a) => ({ ...a, score: sMap.get(a.name)?.score, matchReason: sMap.get(a.name)?.reason }))
    .sort((x, y) => (y.score ?? 0) - (x.score ?? 0));

  return { mode: "place", destination: place, country, city, heroImage, cultureTips, countryFacts, exchange, wiki, dateWindow, budgetPlan, memories, holidays, attractions: scoredAttractions, food, festivalPlaces, events, weather, stays, suggestedTrips: [], cards, prediction };
}
