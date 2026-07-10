import {
  listDestinationTravelPosts,
  listFollowingTravelPosts,
  listPublicTravelPosts,
  listSavedTravelPostSignals,
  listVectorRankedTravelPosts,
  listVerifiedTravelPosts,
  TravelPostRow
} from "@/lib/db/tables/travel-posts";
import { listTripsForUser } from "@/lib/db/tables/trips";
import { embedText } from "@/lib/ai/llm";
import { listTravelerBookings } from "./booking.service";

/**
 * feed.service - read models and ranking entrypoint.
 * For You ranking blends real Aurora signals:
 * saved posts + trip plans + bookings -> embedding query -> pgvector post relevance
 * plus engagement, verified-stay trust, and recency.
 */

export type FeedTab = "for-you" | "following" | "trending" | "destination" | "verified";

function stringifyProfile(profile: Record<string, unknown> | null | undefined) {
  if (!profile) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(profile)) {
    if (value == null) continue;
    if (Array.isArray(value)) parts.push(`${key}: ${value.join(", ")}`);
    else if (typeof value === "object") parts.push(`${key}: ${JSON.stringify(value)}`);
    else parts.push(`${key}: ${String(value)}`);
  }
  return parts.join("; ");
}

async function buildViewerInterestQuery(viewerId: string) {
  const [savedPosts, trips, bookings] = await Promise.all([
    listSavedTravelPostSignals(viewerId, 8).catch(() => []),
    listTripsForUser(viewerId).catch(() => []),
    listTravelerBookings(viewerId).catch(() => [])
  ]);

  const signals: string[] = [];

  for (const post of savedPosts) {
    signals.push(
      [
        "saved post",
        post.title,
        post.destination,
        post.location,
        post.mood,
        post.tags?.join(", "),
        post.caption
      ]
        .filter(Boolean)
        .join(" | ")
    );
  }

  for (const trip of trips.slice(0, 8)) {
    signals.push(
      [
        "trip",
        trip.title,
        trip.destination,
        trip.travel_style,
        stringifyProfile(trip.profile)
      ]
        .filter(Boolean)
        .join(" | ")
    );
  }

  for (const booking of bookings.slice(0, 8)) {
    signals.push(["booked stay", booking.title, booking.city, booking.status].filter(Boolean).join(" | "));
  }

  const query = signals
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 3000);

  return query || null;
}

async function getForYouFeed(viewerId: string, limit: number): Promise<TravelPostRow[]> {
  const interestQuery = await buildViewerInterestQuery(viewerId);
  if (!interestQuery) return listPublicTravelPosts(limit);

  try {
    const embedding = await embedText(interestQuery);
    const ranked = await listVectorRankedTravelPosts({ embedding, limit });
    if (ranked.length > 0) return ranked;
  } catch (error) {
    console.warn(`[feed] pgvector ranking unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }

  return listPublicTravelPosts(limit);
}

export async function getFeed(params: {
  viewerId: string;
  tab?: FeedTab;
  destination?: string;
  limit?: number;
}): Promise<TravelPostRow[]> {
  const limit = Math.max(1, Math.min(params.limit ?? 20, 50));

  switch (params.tab ?? "for-you") {
    case "following":
      return listFollowingTravelPosts(params.viewerId, limit);
    case "destination":
      return params.destination ? listDestinationTravelPosts(params.destination, limit) : [];
    case "verified":
      return listVerifiedTravelPosts(limit);
    case "trending":
      return listPublicTravelPosts(limit);
    case "for-you":
    default:
      return getForYouFeed(params.viewerId, limit);
  }
}
