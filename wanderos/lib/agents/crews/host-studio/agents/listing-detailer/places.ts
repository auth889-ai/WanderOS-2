/**
 * Real nearby-places lookup for the "Where you'll be" section (Google Maps Places).
 * Geocodes the city, then pulls top attractions, restaurants, and transit nearby. Defensive:
 * returns empty arrays on any failure so the detailer degrades gracefully.
 */
export type NearbyPlaces = { attractions: string[]; dining: string[]; transit: string[] };

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

async function nearby(lat: number, lng: number, type: string, key: string, limit = 6): Promise<string[]> {
  const data = (await fetchJson(
    `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=3000&type=${type}&key=${key}`
  )) as { results?: { name: string }[] };
  return (data.results ?? []).slice(0, limit).map((r) => r.name);
}

export async function fetchNearbyPlaces(city: string): Promise<NearbyPlaces> {
  const empty: NearbyPlaces = { attractions: [], dining: [], transit: [] };
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return empty;
  try {
    const geo = (await fetchJson(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(city)}&key=${key}`
    )) as { results?: { geometry?: { location?: { lat: number; lng: number } } }[] };
    const loc = geo.results?.[0]?.geometry?.location;
    if (!loc) return empty;

    const [attractions, dining, transit] = await Promise.all([
      nearby(loc.lat, loc.lng, "tourist_attraction", key),
      nearby(loc.lat, loc.lng, "restaurant", key),
      nearby(loc.lat, loc.lng, "transit_station", key)
    ]);
    return { attractions, dining, transit };
  } catch {
    return empty;
  }
}
