/** Ticketmaster Discovery — REAL events/concerts/festivals (strong in US/EU; sparse in S. Asia). */
const KEY = process.env.TICKETMASTER_API_KEY;

export type EventItem = { name: string; date?: string; venue?: string; url?: string; category?: string };

export async function findEvents(city: string, lat?: number, lng?: number): Promise<EventItem[]> {
  if (!KEY) return [];
  const geo = lat != null && lng != null ? `&latlong=${lat},${lng}&radius=120&unit=km` : `&city=${encodeURIComponent(city)}`;
  try {
    const r = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?apikey=${KEY}${geo}&size=8&sort=date,asc`);
    const j = (await r.json().catch(() => ({}))) as { _embedded?: { events?: { name: string; url?: string; dates?: { start?: { localDate?: string } }; classifications?: { segment?: { name?: string } }[]; _embedded?: { venues?: { name?: string }[] } }[] } };
    return (j._embedded?.events ?? []).map((e) => ({
      name: e.name, date: e.dates?.start?.localDate, venue: e._embedded?.venues?.[0]?.name, url: e.url,
      category: e.classifications?.[0]?.segment?.name
    }));
  } catch { return []; }
}
