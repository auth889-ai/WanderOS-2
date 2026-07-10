import { getTripVisualForQuery } from "@/lib/media/trip-visuals";
import type { DayArchitecture, TripBrief, TripPlanItem } from "./schemas";
import { TripPlanItemSchema } from "./schemas";

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  googleMapsUri?: string;
  websiteUri?: string;
  rating?: number;
  priceLevel?: string | number;
  types?: string[];
  businessStatus?: string;
  userRatingsTotal?: number;
  openingHoursText?: string[];
  source?: "places_new" | "places_legacy";
};

type GooglePlacesResponse = {
  places?: GooglePlace[];
};

type LegacyTextSearchResponse = {
  status?: string;
  error_message?: string;
  results?: Array<{
    place_id?: string;
    name?: string;
    formatted_address?: string;
    rating?: number;
    price_level?: number;
    types?: string[];
    business_status?: string;
    user_ratings_total?: number;
  }>;
};

type LegacyDetailsResponse = {
  status?: string;
  error_message?: string;
  result?: {
    place_id?: string;
    name?: string;
    formatted_address?: string;
    url?: string;
    website?: string;
    rating?: number;
    price_level?: number;
    types?: string[];
    business_status?: string;
    user_ratings_total?: number;
    opening_hours?: {
      weekday_text?: string[];
    };
  };
};

export type ExternalEnrichmentSummary = {
  places: {
    provider: "google-places" | "not_configured";
    status: "queried" | "skipped";
    itemsMatched: number;
  };
  photos: {
    provider: "unsplash" | "not_configured";
    status: "queried" | "skipped";
    itemsMatched: number;
  };
  costEvidence: {
    provider: "google-places-price-level" | "google-places-place-match" | "planner-estimate";
    status: "provider_backed" | "unverified_estimate";
    priceLevelMatched: number;
  };
};

export type ExternalEnrichmentResult = {
  items: TripPlanItem[];
  summary: ExternalEnrichmentSummary;
};

function placesKey() {
  return process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "";
}

function timeoutSignal(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

function clean(value: string | null | undefined, max: number) {
  return (value || "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

function categoryBase(category?: string | null) {
  const text = (category || "").toLowerCase();
  if (/(food|lunch|dinner|ramen|cafe|restaurant|market)/.test(text)) return 22;
  if (/(museum|gallery|culture|temple|garden)/.test(text)) return 18;
  if (/(view|tower|observation|tour)/.test(text)) return 28;
  if (/(shopping|retail)/.test(text)) return 35;
  if (/(walk|park|photo|logistics|rest)/.test(text)) return 0;
  return 18;
}

function priceLevelLabel(priceLevel?: string | number) {
  if (priceLevel == null || priceLevel === "") return "";
  if (typeof priceLevel === "number") {
    if (priceLevel <= 0) return "PRICE_LEVEL_FREE";
    if (priceLevel === 1) return "PRICE_LEVEL_INEXPENSIVE";
    if (priceLevel === 2) return "PRICE_LEVEL_MODERATE";
    if (priceLevel === 3) return "PRICE_LEVEL_EXPENSIVE";
    return "PRICE_LEVEL_VERY_EXPENSIVE";
  }
  return priceLevel;
}

function priceLevelMultiplier(priceLevel?: string | number) {
  const label = priceLevelLabel(priceLevel);
  if (!label) return null;
  if (label.includes("FREE")) return 0;
  if (label.includes("INEXPENSIVE")) return 0.75;
  if (label.includes("MODERATE")) return 1.15;
  if (label.includes("EXPENSIVE")) return 1.8;
  if (label.includes("VERY_EXPENSIVE")) return 2.8;
  return null;
}

function estimateCost(item: TripPlanItem, place: GooglePlace | null) {
  const base = categoryBase(item.category);
  const multiplier = priceLevelMultiplier(place?.priceLevel);

  if (multiplier != null) {
    const amount = Math.round(base * multiplier);
    return {
      estCost: amount,
      costSource: "google_places_price_level",
      costRationale: `Estimated from Google Places price level ${priceLevelLabel(place?.priceLevel)}; not a live ticket or menu price.`
    };
  }

  return {
    estCost: Math.max(0, Math.round(Number(item.estCost || base))),
    costSource: place ? "google_places_no_price_level" : "planner_estimate_unverified",
    costRationale: place
      ? "Google Places matched the venue but did not return a price level, so the planner kept a conservative category estimate."
      : "No Google Places key or match was available, so this remains an unverified planning estimate."
  };
}

function selectionRationale(input: {
  item: TripPlanItem;
  place: GooglePlace | null;
  destination: string;
  area: string;
  interests: string[];
}) {
  const interestText = input.interests.length ? `traveler interests (${input.interests.slice(0, 4).join(", ")})` : "the trip brief";
  const placeEvidence = input.place
    ? `Google Places matched ${input.place.displayName?.text || input.item.title} with rating ${input.place.rating ?? "not rated"} and categories ${(input.place.types ?? []).slice(0, 3).join(", ") || "not listed"}.`
    : "No external place match was available, so this remains an AI-planned activity candidate.";

  return clean(
    `${input.item.title} is included because it fits ${interestText}, anchors the ${input.area} part of ${input.destination}, and supports the day's ${input.item.category || "activity"} focus. ${placeEvidence}`,
    700
  );
}

function timingRationale(input: { item: TripPlanItem; area: string; openingHours?: string[] }) {
  const time = clean(input.item.timeLabel || "Flexible", 40);
  const hours = input.openingHours?.length
    ? ` Google opening-hours evidence is available for traveler verification.`
    : "";
  return clean(
    `${time} is used to keep the day clustered around ${input.area} and leave room for meals, transit, and edits.${hours}`,
    500
  );
}

function legacyPlaceToGooglePlace(place: NonNullable<LegacyDetailsResponse["result"]> | NonNullable<LegacyTextSearchResponse["results"]>[number]): GooglePlace {
  return {
    id: "place_id" in place ? place.place_id : undefined,
    displayName: { text: "name" in place ? place.name : undefined },
    formattedAddress: "formatted_address" in place ? place.formatted_address : undefined,
    googleMapsUri: "url" in place ? place.url : undefined,
    websiteUri: "website" in place ? place.website : undefined,
    rating: "rating" in place ? place.rating : undefined,
    priceLevel: "price_level" in place ? place.price_level : undefined,
    types: "types" in place ? place.types : undefined,
    businessStatus: "business_status" in place ? place.business_status : undefined,
    userRatingsTotal: "user_ratings_total" in place ? place.user_ratings_total : undefined,
    openingHoursText: "opening_hours" in place ? place.opening_hours?.weekday_text : undefined,
    source: "places_legacy"
  };
}

async function searchLegacyGooglePlace(query: string): Promise<GooglePlace | null> {
  const key = placesKey();
  if (!key) return null;

  const searchUrl = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  searchUrl.searchParams.set("query", query);
  searchUrl.searchParams.set("key", key);
  searchUrl.searchParams.set("language", "en");

  const request = timeoutSignal(6000);
  try {
    const response = await fetch(searchUrl, { signal: request.signal });
    if (!response.ok) return null;
    const payload = (await response.json()) as LegacyTextSearchResponse;
    const first = payload.results?.[0];
    if (!first?.place_id) return first ? legacyPlaceToGooglePlace(first) : null;

    const detailsUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json");
    detailsUrl.searchParams.set("place_id", first.place_id);
    detailsUrl.searchParams.set("key", key);
    detailsUrl.searchParams.set("language", "en");
    detailsUrl.searchParams.set(
      "fields",
      [
        "place_id",
        "name",
        "formatted_address",
        "url",
        "website",
        "rating",
        "price_level",
        "types",
        "business_status",
        "user_ratings_total",
        "opening_hours"
      ].join(",")
    );

    const detailsResponse = await fetch(detailsUrl, { signal: request.signal });
    if (!detailsResponse.ok) return legacyPlaceToGooglePlace(first);
    const details = (await detailsResponse.json()) as LegacyDetailsResponse;
    return details.result ? legacyPlaceToGooglePlace(details.result) : legacyPlaceToGooglePlace(first);
  } catch {
    return null;
  } finally {
    request.cancel();
  }
}

async function searchGooglePlace(query: string): Promise<GooglePlace | null> {
  const key = placesKey();
  if (!key) return null;

  const request = timeoutSignal(4500);
  try {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": [
          "places.id",
          "places.displayName",
          "places.formattedAddress",
          "places.googleMapsUri",
          "places.websiteUri",
          "places.rating",
          "places.priceLevel",
          "places.types"
        ].join(",")
      },
      body: JSON.stringify({
        textQuery: query,
        languageCode: "en"
      }),
      signal: request.signal
    });

    if (!response.ok) return searchLegacyGooglePlace(query);
    const payload = (await response.json()) as GooglePlacesResponse;
    const place = payload.places?.[0];
    return place ? { ...place, source: "places_new" } : searchLegacyGooglePlace(query);
  } catch {
    return searchLegacyGooglePlace(query);
  } finally {
    request.cancel();
  }
}

function dayArea(days: DayArchitecture["days"], dayNumber: number, destination: string) {
  return clean(days.find((day) => day.dayNumber === dayNumber)?.area || destination, 120);
}

function attributionFromVisual(visual: Awaited<ReturnType<typeof getTripVisualForQuery>>) {
  if (!visual || visual.source !== "unsplash") return {};
  return {
    source: "unsplash",
    photographerName: visual.photographerName,
    photographerUrl: visual.photographerUrl,
    photoUrl: visual.photoUrl
  };
}

export async function enrichTripActivities(input: {
  brief: TripBrief;
  dayArchitecture: DayArchitecture;
  items: TripPlanItem[];
}): Promise<ExternalEnrichmentResult> {
  const hasPlaces = Boolean(placesKey());
  const hasPhotos = Boolean(process.env.UNSPLASH_ACCESS_KEY);
  const enriched = await Promise.all(input.items.map(async (item) => {
    const area = dayArea(input.dayArchitecture.days, item.dayNumber, input.brief.destination);
    const query = clean(`${item.title} ${area} ${input.brief.destination}`, 260);
    const [place, visual] = await Promise.all([
      searchGooglePlace(query),
      getTripVisualForQuery({
        query: `${input.brief.destination} ${area} ${item.title} travel`,
        destination: input.brief.destination
      })
    ]);

    const cost = estimateCost(item, place);
    return TripPlanItemSchema.parse({
      ...item,
      estCost: cost.estCost,
      placeName: clean(place?.displayName?.text || item.placeName || item.title, 180),
      placeAddress: clean(place?.formattedAddress || "", 260) || null,
      placeUrl: place?.googleMapsUri || place?.websiteUri || null,
      externalPlaceId: place?.id || null,
      placeRating: typeof place?.rating === "number" ? place.rating : null,
      imageUrl: visual?.src ?? null,
      imageAttribution: attributionFromVisual(visual),
      selectionRationale: selectionRationale({
        item,
        place,
        destination: input.brief.destination,
        area,
        interests: input.brief.interests
      }),
      timingRationale: timingRationale({
        item,
        area,
        openingHours: place?.openingHoursText
      }),
      costSource: cost.costSource,
      costRationale: cost.costRationale,
      metadata: {
        ...(item.metadata ?? {}),
        externalQuery: query,
        googlePlaceTypes: place?.types ?? [],
        googlePriceLevel: priceLevelLabel(place?.priceLevel) || null,
        googlePlaceSource: place?.source ?? null,
        googleBusinessStatus: place?.businessStatus ?? null,
        googleUserRatingsTotal: place?.userRatingsTotal ?? null,
        googleOpeningHours: place?.openingHoursText ?? [],
        googleWebsite: place?.websiteUri ?? null,
        imageSource: visual?.source ?? null,
        enrichmentGeneratedAt: new Date().toISOString()
      }
    });
  }));

  const placesMatched = enriched.filter((item) => item.externalPlaceId).length;
  const priceLevelMatched = enriched.filter((item) => item.metadata?.googlePriceLevel).length;
  const photosMatched = enriched.filter((item) => item.metadata?.imageSource === "unsplash").length;

  return {
    items: enriched,
    summary: {
      places: {
        provider: hasPlaces ? "google-places" : "not_configured",
        status: hasPlaces ? "queried" : "skipped",
        itemsMatched: placesMatched
      },
      photos: {
        provider: hasPhotos ? "unsplash" : "not_configured",
        status: hasPhotos ? "queried" : "skipped",
        itemsMatched: photosMatched
      },
      costEvidence: {
        provider: priceLevelMatched ? "google-places-price-level" : placesMatched ? "google-places-place-match" : "planner-estimate",
        status: placesMatched ? "provider_backed" : "unverified_estimate"
        ,
        priceLevelMatched
      }
    }
  };
}
