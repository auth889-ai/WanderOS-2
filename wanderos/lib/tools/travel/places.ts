/** Google Places + Geocoding — REAL attractions, ratings, photos, coordinates. */
const KEY = process.env.GOOGLE_MAPS_API_KEY;

export type Place = { name: string; address?: string; rating?: number; userRatings?: number; photoUrl?: string; types?: string[] };
export type GeoResult = { lat: number; lng: number; country: string; city: string; formatted: string };

export async function geocode(place: string): Promise<GeoResult | null> {
  if (!KEY || !place) return null;
  try {
    const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(place)}&key=${KEY}`);
    const j = (await r.json().catch(() => ({}))) as { results?: { address_components?: { types: string[]; short_name: string; long_name: string }[]; geometry?: { location: { lat: number; lng: number } }; formatted_address?: string }[] };
    const res = j.results?.[0];
    if (!res?.geometry) return null;
    const comp = res.address_components ?? [];
    return {
      lat: res.geometry.location.lat, lng: res.geometry.location.lng,
      country: comp.find((c) => c.types.includes("country"))?.short_name ?? "",
      city: comp.find((c) => c.types.includes("locality"))?.long_name ?? comp.find((c) => c.types.includes("administrative_area_level_1"))?.long_name ?? (res.formatted_address ?? place),
      formatted: res.formatted_address ?? place
    };
  } catch { return null; }
}

export async function searchPlaces(query: string, limit = 8): Promise<Place[]> {
  if (!KEY || !query) return [];
  try {
    const r = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${KEY}`);
    const j = (await r.json().catch(() => ({}))) as { results?: { name: string; formatted_address?: string; rating?: number; user_ratings_total?: number; types?: string[]; photos?: { photo_reference: string }[] }[] };
    return (j.results ?? []).slice(0, limit).map((p) => ({
      name: p.name, address: p.formatted_address, rating: p.rating, userRatings: p.user_ratings_total, types: p.types,
      photoUrl: p.photos?.[0]?.photo_reference ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=640&photo_reference=${p.photos[0].photo_reference}&key=${KEY}` : undefined
    }));
  } catch { return []; }
}
