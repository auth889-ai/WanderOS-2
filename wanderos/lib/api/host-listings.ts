/**
 * Typed client for the host-listing API. The ONLY place the host UI calls `fetch` — components and
 * hooks import these functions instead of hitting endpoints directly, so the network surface is
 * centralized, typed, and easy to change/mocked.
 */

export type ListingRow = {
  id: string;
  host_id: string;
  title: string;
  description: string;
  city: string;
  country: string;
  category: string;
  price: string;
  bedrooms: number | null;
  bathrooms: number | null;
  max_guests: number | null;
  amenities: string[];
  tags: string[];
  status: string;
  moderation_status: string;
  image_url: string | null;
  details: ListingDetails;
  tour?: { video_id?: string; type?: string; url?: string; thumbnail?: string; status?: string } | null;
};

export type ListingDetails = {
  photos?: string[];
  listingHighlights?: { title: string; subtitle: string }[];
  roomBreakdown?: { name: string; details: string[] }[];
  whereYouWillSleep?: { space: string; beds: string }[];
  amenityGroups?: { category: string; items: string[] }[];
  whatThisPlaceOffers?: string[];
  unavailable?: string[];
  notProvided?: string[];
  guestAccess?: string;
  otherThingsToNote?: string[];
  safetyProperty?: string[];
  idealFor?: string[];
  houseRules?: { checkIn?: string; checkOut?: string; maxGuests?: number; smoking?: string; pets?: string; additional?: string[] };
  locationHighlights?: { attractions?: string[]; dining?: string[]; transit?: string[]; gettingAround?: string };
  shortDescription?: string;
  highlights?: string[];
  [k: string]: unknown;
};

export type JobView = { type: string; status: string; progress: number; stage: string | null; error: string | null };

export type StartDraftBody = {
  city: string;
  country: string;
  category: string;
  notes: string;
  photos: string[];
  videoMode?: string;
  submitId?: string;
};

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export async function startDraft(body: StartDraftBody): Promise<{ listingId: string; jobId: string }> {
  return json(
    await fetch("/api/host/listings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

export async function getMyListings(): Promise<ListingRow[]> {
  return (await json<{ listings: ListingRow[] }>(await fetch("/api/host/listings"))).listings;
}

export async function getListing(id: string): Promise<ListingRow> {
  return (await json<{ listing: ListingRow }>(await fetch(`/api/host/listings/${id}`))).listing;
}

export async function editListing(id: string, patch: Record<string, unknown>): Promise<ListingRow> {
  return (
    await json<{ listing: ListingRow }>(
      await fetch(`/api/host/listings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      })
    )
  ).listing;
}

export async function publishListing(id: string): Promise<ListingRow> {
  return (await json<{ listing: ListingRow }>(await fetch(`/api/host/listings/${id}/publish`, { method: "POST" }))).listing;
}

export async function deleteListing(id: string): Promise<void> {
  await json(await fetch(`/api/host/listings/${id}`, { method: "DELETE" }));
}

export async function cancelJob(id: string): Promise<void> {
  await json(await fetch(`/api/host/listings/${id}/cancel`, { method: "POST" }));
}

export async function retryJob(id: string): Promise<void> {
  await json(await fetch(`/api/host/listings/${id}/retry`, { method: "POST" }));
}

/** Upload one image file to Cloudinary → hosted URL (small request per photo, scales to many). */
export async function uploadPhoto(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/host/uploads", { method: "POST", body: fd });
  return (await json<{ url: string }>(res)).url;
}

/** The SSE endpoint URL (the hook opens an EventSource on it). */
export const jobStreamUrl = (id: string) => `/api/host/listings/${id}/stream`;
