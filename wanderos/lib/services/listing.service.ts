import {
  createListing,
  insertDraft,
  applyDraftFields,
  setStatus,
  updateListing as repoUpdate,
  getById,
  listByHost,
  setModeration,
  ListingRow,
  CreateListingInput
} from "@/lib/db/tables/listings";
import { insertMany, NewMedia } from "@/lib/db/tables/listing-media";
import { saveVersion } from "@/lib/db/tables/listing-versions";
import { listJobsForListing, requestCancel, markCancelled } from "@/lib/db/tables/agent-jobs";
import { enqueueJob, removeQueuedJob } from "@/lib/queue/queues";
import { randomUUID } from "crypto";
import { ComposedListing } from "@/lib/agents/crews/host-studio/agents/final-composer/schema";
import { ListingDetails } from "@/lib/agents/crews/host-studio/agents/listing-detailer/schema";
import { canTransition, isEditable, ListingStatus } from "./lifecycle";

/**
 * listing.service — the DECISION + COMMIT layer for host listings (NO LLM, NO money path).
 * Owns: the draft lifecycle (state machine), RBAC (only the owning host edits), version history
 * (every edit is snapshotted), and the studio-job → listing handoff. Agents only draft; this commits.
 */

export type TransitionResult = { ok: true; listing: ListingRow } | { ok: false; error: string };

/** Snapshot of the editable fields (for version history). */
function snapshotOf(r: ListingRow) {
  return {
    title: r.title,
    description: r.description,
    price: r.price,
    bedrooms: r.bedrooms,
    bathrooms: r.bathrooms,
    maxGuests: r.max_guests,
    amenities: r.amenities,
    tags: r.tags,
    houseRules: r.house_rules,
    details: r.details,
    status: r.status
  };
}

// ─────────────────────────────── async draft flow ───────────────────────────────

/** Start a draft: insert the placeholder row (idempotent on listingId), with the cover photo if given. */
export async function createDraft(
  hostId: string,
  input: { listingId: string; city: string; country: string; category: string; coverUrl?: string }
): Promise<ListingRow> {
  return insertDraft({ id: input.listingId, hostId, city: input.city, country: input.country, category: input.category, imageUrl: input.coverUrl });
}

export type StartDraftInput = {
  city: string;
  country: string;
  category: string;
  notes: string;
  photos: string[];
  submitId?: string; // client-provided → idempotent across double-submits
};

/** The full create flow the API calls: insert the draft row + enqueue the studio job (both idempotent). */
export async function startStudioDraft(hostId: string, input: StartDraftInput): Promise<{ listing: ListingRow; jobId: string }> {
  const listingId = input.submitId ?? randomUUID();
  const listing = await createDraft(hostId, { listingId, city: input.city, country: input.country, category: input.category, coverUrl: input.photos[0] });
  const job = await enqueueJob({
    type: "studio",
    listingId,
    userId: hostId,
    idempotencyKey: `studio-${listingId}`,
    input: { userId: hostId, listingId, category: input.category, city: input.city, country: input.country, notes: input.notes, photos: input.photos }
  });
  return { listing, jobId: job.id };
}

/** Host cancels the in-flight job. Queued → remove + mark cancelled now; running → flag (worker honors it). */
export async function cancelDraft(listingId: string, hostId: string): Promise<{ ok: boolean; error?: string }> {
  const listing = await getById(listingId);
  if (!listing || listing.host_id !== hostId) return { ok: false, error: "not found or not the owner" };
  const active = (await listJobsForListing(listingId)).find((j) => j.status === "queued" || j.status === "running");
  if (!active) return { ok: false, error: "no active job to cancel" };
  await requestCancel(active.id);
  if (active.status === "queued") {
    await removeQueuedJob(active.type, active.idempotency_key ?? "");
    await markCancelled(active.id);
  }
  return { ok: true };
}

/** Retry a failed job — re-enqueue with the original input under a fresh key. */
export async function retryDraft(
  listingId: string,
  hostId: string
): Promise<{ ok: boolean; jobId?: string; idempotencyKey?: string; error?: string }> {
  const listing = await getById(listingId);
  if (!listing || listing.host_id !== hostId) return { ok: false, error: "not found or not the owner" };
  const failed = (await listJobsForListing(listingId)).find((j) => j.status === "failed");
  if (!failed) return { ok: false, error: "no failed job to retry" };
  const idempotencyKey = `${failed.type}-${listingId}-retry-${Date.now()}`;
  const job = await enqueueJob({ type: failed.type, listingId, userId: hostId, idempotencyKey, input: failed.input });
  return { ok: true, jobId: job.id, idempotencyKey };
}

/** The worker calls this when the studio crew finishes — writes the AI draft into the row + snapshots v1. */
export async function applyStudioDraft(
  listingId: string,
  result: { draft: ComposedListing; details: ListingDetails; photos?: string[] }
): Promise<ListingRow | null> {
  const d = result.draft;
  const updated = await applyDraftFields(listingId, {
    title: d.title,
    description: d.longDescription,
    price: d.price,
    bedrooms: d.bedrooms,
    bathrooms: d.bathrooms,
    maxGuests: d.maxGuests,
    amenities: d.amenities,
    tags: d.tags,
    pricingAnalysis: { suggested: d.price, min: d.priceMin, max: d.priceMax, currency: d.currency, confidence: d.confidence },
    // the full premium detail + the extra draft bits the detail/marketplace page renders
    details: {
      ...result.details,
      photos: result.photos ?? [], // full gallery (Cloudinary URLs) for the Airbnb-style photo grid
      shortDescription: d.shortDescription,
      highlights: d.highlights,
      vibes: d.vibes,
      hostSummary: d.hostSummary,
      thingsToConfirm: d.thingsToConfirm,
      readyToPublish: d.readyToPublish,
      safetyVerdict: d.safetyVerdict,
      riskLevel: d.riskLevel
    }
  });
  if (updated) await saveVersion({ listingId, snapshot: snapshotOf(updated), note: "ai draft" });
  return updated;
}

// ─────────────────────────────── host control (RBAC + versioning) ───────────────────────────────

/** Edit any time: RBAC-scoped, only in an editable state, snapshots the prior version first. */
export async function editListing(
  listingId: string,
  hostId: string,
  patch: Record<string, unknown>
): Promise<ListingRow | null> {
  const current = await getById(listingId);
  if (!current || current.host_id !== hostId) return null; // RBAC: not owner
  if (!isEditable(current.status)) return null; // can't edit published/archived/deleted directly
  await saveVersion({ listingId, snapshot: snapshotOf(current), editedBy: hostId, note: "edit" });
  return repoUpdate(listingId, hostId, patch);
}

/** Guarded lifecycle transition (RBAC + state machine). */
export async function transitionListing(listingId: string, hostId: string, to: ListingStatus): Promise<TransitionResult> {
  const current = await getById(listingId);
  if (!current || current.host_id !== hostId) return { ok: false, error: "not found or not the owner" };
  if (!canTransition(current.status, to)) return { ok: false, error: `invalid transition: ${current.status} → ${to}` };
  const moderation = to === "pending_review" ? "pending_review" : to === "approved" ? "approved" : undefined;
  const listing = await setStatus(listingId, hostId, to, moderation);
  return listing ? { ok: true, listing } : { ok: false, error: "update failed" };
}

/** Host submits the draft for admin review. */
export const publish = (listingId: string, hostId: string) => transitionListing(listingId, hostId, "pending_review");
export const archiveListing = (listingId: string, hostId: string) => transitionListing(listingId, hostId, "archived");
/** Soft delete — keeps the row (and revenue history) but hides it from the host's active listings. */
export const deleteListing = (listingId: string, hostId: string) => transitionListing(listingId, hostId, "deleted");

// ─────────────────────────────── reads ───────────────────────────────

export async function getHostListings(hostId: string): Promise<ListingRow[]> {
  return listByHost(hostId);
}

export async function getListing(id: string): Promise<ListingRow | null> {
  return getById(id);
}

/** Admin moderation gate (approve/reject) — the only path to public. Approve also publishes. */
export async function moderateListing(id: string, status: "approved" | "rejected"): Promise<ListingRow | null> {
  return setModeration(id, status);
}

// ─────────────────────────────── legacy inline save (kept for the existing path/test) ───────────────────────────────

export type SaveListingParams = {
  listingId: string;
  hostId: string;
  draft: ComposedListing;
  photoUrls: string[];
};

/** Persist a host-reviewed draft in one shot (the older inline path): the listing row + its media. */
export async function saveListing(params: SaveListingParams): Promise<ListingRow> {
  const d = params.draft;
  const input: CreateListingInput = {
    id: params.listingId,
    hostId: params.hostId,
    title: d.title,
    description: d.longDescription,
    city: d.city,
    country: d.country,
    category: d.category,
    price: d.price,
    bedrooms: d.bedrooms,
    bathrooms: d.bathrooms,
    maxGuests: d.maxGuests,
    amenities: d.amenities,
    rooms: [],
    tags: d.tags,
    pricingAnalysis: { suggested: d.price, min: d.priceMin, max: d.priceMax, currency: d.currency },
    tour: { status: "queued" },
    imageUrl: params.photoUrls[0],
    status: "draft"
  };
  const listing = await createListing(input);
  const media: NewMedia[] = params.photoUrls.map((url) => ({ url, type: "image" as const }));
  await insertMany(listing.id, media);
  return listing;
}
