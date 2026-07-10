import { enqueueJob } from "@/lib/queue/queues";
import { queryAurora } from "@/lib/db/pool";
import { getListing } from "./listing.service";
import { createVideo, getVideo, listVideosForListing, type ListingVideoRow } from "@/lib/db/tables/listing-videos";

/**
 * hostVideo.service — the commit layer for listing videos (the API stays thin).
 * RBAC (owner only) · gathers the listing's photos · creates the listing_videos row · enqueues the
 * listing_video job. Each Generate / re-render = a fresh job. The worker runs the crew + render.
 */
export type VideoType = "tour" | "reel"; // tour = narrated (Type 2) · reel = motion only (Type 1)

export interface StartVideoInput {
  listingId: string;
  type: VideoType;
  mode?: string;
  resolution?: "720p" | "1080p";
  narration?: string;
  musicMood?: string;
}

export async function startListingVideo(
  hostId: string,
  input: StartVideoInput
): Promise<{ ok: boolean; videoId?: string; jobId?: string; error?: string }> {
  const listing = await getListing(input.listingId).catch(() => null);
  if (!listing || listing.host_id !== hostId) return { ok: false, error: "not found or not the owner" };

  const details = (listing.details ?? {}) as { photos?: string[] };
  const photoUrls = details.photos?.length ? details.photos : listing.image_url ? [listing.image_url] : [];
  if (!photoUrls.length) return { ok: false, error: "this listing has no photos to animate" };

  const mode = input.mode ?? "walkthrough";
  const resolution = input.resolution ?? "1080p";
  const brief = { mode, resolution, photoUrls, narration: input.narration, musicMood: input.musicMood };
  const idempotencyKey = `video-${input.listingId}-${input.type}-${Date.now()}`; // each render is a fresh job

  // create the manifest row first so the worker can update it by id
  const video = await createVideo({ listingId: input.listingId, hostId, type: input.type, mode, resolution, brief });
  const job = await enqueueJob({
    type: "listing_video",
    listingId: input.listingId,
    userId: hostId,
    idempotencyKey,
    input: { videoId: video.id, listingId: input.listingId, type: input.type, brief, listingTitle: listing.title, city: listing.city, narrate: input.type === "tour" }
  });
  return { ok: true, videoId: video.id, jobId: job.id };
}

export async function getListingVideo(hostId: string, videoId: string): Promise<ListingVideoRow | null> {
  const v = await getVideo(videoId);
  return v && v.host_id === hostId ? v : null;
}

export async function listListingVideos(hostId: string, listingId: string): Promise<ListingVideoRow[]> {
  const listing = await getListing(listingId).catch(() => null);
  if (!listing || listing.host_id !== hostId) return [];
  return listVideosForListing(listingId);
}

/** Attach a finished video to the listing → it shows on the detail page and travels into publish/marketplace. */
export async function attachVideoToListing(
  hostId: string,
  listingId: string,
  videoId: string
): Promise<{ ok: boolean; error?: string }> {
  const v = await getVideo(videoId);
  if (!v || v.host_id !== hostId || v.listing_id !== listingId) return { ok: false, error: "not found or not the owner" };
  if (v.status !== "ready" || !v.url) return { ok: false, error: "video is not ready yet" };
  await queryAurora(
    `update listings set tour=$2::jsonb, updated_at=now() where id=$1 and host_id=$3`,
    [listingId, JSON.stringify({ video_id: v.id, type: v.type, url: v.url, thumbnail: v.thumbnail_url, status: "ready" }), hostId]
  );
  return { ok: true };
}
