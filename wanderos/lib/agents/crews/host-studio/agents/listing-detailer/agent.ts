import { invokeStructured } from "@/lib/ai/structured";
import { ListingDetailsSchema, ListingDetails, DetailerInput } from "./schema";
import { buildDetailerPrompt } from "./prompt";
import { fetchNearbyPlaces } from "./places";

/**
 * listing-detailer agent — produces the Airbnb-depth structured detail.
 *
 * Action-taking: it FETCHES real nearby places (Google Maps) for the "Where you'll be" section,
 * then structures the room-by-room breakdown, what's offered/unavailable, not-provided, house rules,
 * and location highlights — grounded in the per-room vision evidence + amenities + safety flags.
 * "pro" tier — careful structuring over multiple inputs.
 */
export async function listingDetailer(input: DetailerInput): Promise<ListingDetails> {
  const places = await fetchNearbyPlaces(input.city);
  return invokeStructured(ListingDetailsSchema, buildDetailerPrompt(input, places), { tier: "pro" });
}
