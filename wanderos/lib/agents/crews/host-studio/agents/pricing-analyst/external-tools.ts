import { tool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * EXTERNAL market-intelligence tools the pricing-analyst can call (real world, not just our DB).
 * Each is defensive: on any API failure it returns a JSON note instead of throwing, so the agent
 * degrades gracefully and still prices from internal comps. The LLM decides when to call them.
 *   locationIntel  → Google Maps/Places: nearby attractions = location desirability/demand
 *   seasonalDemand → Ticketmaster events + Calendarific holidays = time-based demand pressure
 */

const COUNTRY_ISO2: Record<string, string> = {
  bangladesh: "BD", india: "IN", "united states": "US", usa: "US", "united kingdom": "GB",
  uk: "GB", canada: "CA", australia: "AU", france: "FR", germany: "DE", italy: "IT",
  spain: "ES", japan: "JP", thailand: "TH", indonesia: "ID", "united arab emirates": "AE", uae: "AE"
};

async function fetchJson(url: string, ms = 8000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export const locationIntelTool = tool(
  async ({ city }: { city: string }) => {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) return JSON.stringify({ available: false, reason: "no GOOGLE_MAPS_API_KEY" });
    try {
      const geo = (await fetchJson(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(city)}&key=${key}`
      )) as { results?: { geometry?: { location?: { lat: number; lng: number } } }[] };
      const loc = geo.results?.[0]?.geometry?.location;
      if (!loc) return JSON.stringify({ available: false, reason: "city not geocoded" });

      const near = (await fetchJson(
        `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${loc.lat},${loc.lng}&radius=3000&type=tourist_attraction&key=${key}`
      )) as { results?: { name: string; rating?: number }[] };
      const places = near.results ?? [];
      const rated = places.filter((p) => typeof p.rating === "number");
      const avgRating = rated.length ? Number((rated.reduce((s, p) => s + (p.rating || 0), 0) / rated.length).toFixed(2)) : null;

      return JSON.stringify({
        available: true,
        city,
        nearbyAttractions: places.length,
        avgAttractionRating: avgRating,
        topPlaces: places.slice(0, 5).map((p) => p.name)
      });
    } catch (e) {
      return JSON.stringify({ available: false, reason: `maps error: ${(e as Error).message}` });
    }
  },
  {
    name: "locationIntel",
    description:
      "Get real-world location desirability for the city via Google Maps: count + ratings of nearby attractions. More/higher-rated attractions => stronger demand => supports a higher price.",
    schema: z.object({ city: z.string().describe("the property's city") })
  }
);

export const seasonalDemandTool = tool(
  async ({ city, country }: { city: string; country: string }) => {
    const out: Record<string, unknown> = { available: false, city };

    // real upcoming events (Ticketmaster)
    const tmKey = process.env.TICKETMASTER_API_KEY;
    if (tmKey) {
      try {
        const data = (await fetchJson(
          `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${tmKey}&city=${encodeURIComponent(city)}&size=10&sort=date,asc`
        )) as { _embedded?: { events?: { name: string; dates?: { start?: { localDate?: string } } }[] } };
        const events = data._embedded?.events ?? [];
        out.upcomingEvents = events.slice(0, 5).map((e) => ({ name: e.name, date: e.dates?.start?.localDate }));
        out.eventCount = events.length;
        out.available = true;
      } catch (e) {
        out.eventsError = (e as Error).message;
      }
    }

    // upcoming holidays (Calendarific)
    const calKey = process.env.CALENDARIFIC_API_KEY;
    const iso = COUNTRY_ISO2[country.trim().toLowerCase()];
    if (calKey && iso) {
      try {
        const year = new Date().getFullYear();
        const data = (await fetchJson(
          `https://calendarific.com/api/v2/holidays?api_key=${calKey}&country=${iso}&year=${year}`
        )) as { response?: { holidays?: { name: string; date?: { iso?: string }; type?: string[] }[] } };
        const today = new Date().toISOString().slice(0, 10);
        const upcoming = (data.response?.holidays ?? [])
          .filter((h) => (h.date?.iso ?? "") >= today)
          .slice(0, 5)
          .map((h) => ({ name: h.name, date: h.date?.iso }));
        out.upcomingHolidays = upcoming;
        out.available = true;
      } catch (e) {
        out.holidaysError = (e as Error).message;
      }
    }

    return JSON.stringify(out);
  },
  {
    name: "seasonalDemand",
    description:
      "Get time-based demand pressure: real upcoming events (Ticketmaster) + holidays (Calendarific) for the city/country. Events/holidays soon => higher demand => supports a temporary price premium.",
    schema: z.object({
      city: z.string().describe("the property's city"),
      country: z.string().describe("the property's country")
    })
  }
);

export const externalPricingTools = [locationIntelTool, seasonalDemandTool];
