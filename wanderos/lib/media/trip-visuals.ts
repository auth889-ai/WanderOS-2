export type TripVisual = {
  src: string;
  alt: string;
  source: "unsplash" | "local";
  photographerName?: string;
  photographerUrl?: string;
  photoUrl?: string;
};

const LOCAL_VISUALS: TripVisual[] = [
  { src: "/images/traveler-dashboard/t_6.png", alt: "Temple beside a lake at sunrise", source: "local" },
  { src: "/images/traveler-dashboard/m6.png", alt: "Pagoda and city skyline at golden hour", source: "local" },
  { src: "/images/traveler-dashboard/m4.png", alt: "City park at dusk with blossom trees", source: "local" },
  { src: "/images/traveler-dashboard/m5.png", alt: "Pink blossoms over a walking path", source: "local" },
  { src: "/images/traveler-dashboard/city.jpg", alt: "Travel city scene", source: "local" }
];

type UnsplashPhoto = {
  alt_description?: string | null;
  description?: string | null;
  urls?: {
    regular?: string;
    small?: string;
  };
  links?: {
    html?: string;
  };
  user?: {
    name?: string;
    links?: {
      html?: string;
    };
  };
};

type UnsplashSearchResponse = {
  results?: UnsplashPhoto[];
};

function fallbackVisual(index: number) {
  return LOCAL_VISUALS[index % LOCAL_VISUALS.length];
}

function toVisual(photo: UnsplashPhoto, destination: string): TripVisual | null {
  const src = photo.urls?.regular || photo.urls?.small;
  if (!src) return null;
  return {
    src,
    alt: photo.alt_description || photo.description || `${destination} travel image`,
    source: "unsplash",
    photographerName: photo.user?.name,
    photographerUrl: photo.user?.links?.html,
    photoUrl: photo.links?.html
  };
}

async function fetchUnsplashByQuery(query: string, destination: string, count: number): Promise<TripVisual[]> {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) return [];

  const url = new URL("https://api.unsplash.com/search/photos");
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", String(Math.max(1, Math.min(12, count))));
  url.searchParams.set("orientation", "landscape");
  url.searchParams.set("content_filter", "high");
  url.searchParams.set("order_by", "relevant");

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Client-ID ${accessKey}`,
        "Accept-Version": "v1"
      },
      next: { revalidate: 60 * 60 * 6 }
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as UnsplashSearchResponse;
    return (payload.results ?? [])
      .map((photo) => toVisual(photo, destination))
      .filter((visual): visual is TripVisual => Boolean(visual));
  } catch {
    return [];
  }
}

async function fetchUnsplash(destination: string, count: number): Promise<TripVisual[]> {
  return fetchUnsplashByQuery(`${destination} travel landmarks city`, destination, count);
}

export async function getTripVisualForQuery(params: {
  query: string;
  destination: string;
  fallbackIndex?: number;
}): Promise<TripVisual | null> {
  const unsplash = await fetchUnsplashByQuery(params.query, params.destination, 1);
  return unsplash[0] || null;
}

export async function getTripVisuals(params: {
  destination: string;
  dayCount: number;
}): Promise<{ hero: TripVisual; days: Record<number, TripVisual> }> {
  const count = Math.max(1, params.dayCount + 1);
  const unsplash = await fetchUnsplash(params.destination, count);
  const pool = Array.from({ length: count }, (_, index) => unsplash[index] || fallbackVisual(index));
  const days: Record<number, TripVisual> = {};

  for (let index = 1; index <= params.dayCount; index += 1) {
    days[index] = pool[index] || fallbackVisual(index);
  }

  return {
    hero: pool[0] || fallbackVisual(0),
    days
  };
}
