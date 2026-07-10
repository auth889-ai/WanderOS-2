import { randomUUID } from "crypto";
import { getTripForUser } from "@/lib/db/tables/trips";
import {
  applyPostComposeResult,
  applyPostModeration,
  createPostDraft,
  getTravelPostById,
  getTravelPostForAuthor,
  incrementPostView,
  listTravelPostsForAuthor,
  setPostComposeJob,
  setVerifiedStay,
  softDeletePost,
  TravelPostRow,
  updatePostContent,
  updatePostStatus
} from "@/lib/db/tables/travel-posts";
import { addPostMedia, listPostMedia, PostMediaRow } from "@/lib/db/tables/post/media";
import { setPostReaction, removePostReaction, PostReactionKind } from "@/lib/db/tables/post/reactions";
import { savePost, unsavePost } from "@/lib/db/tables/post/saves";
import { addPostComment, listPostComments, PostCommentRow } from "@/lib/db/tables/post/comments";
import { recordPostAttribution } from "@/lib/db/tables/post/attributions";
import { enqueueJob } from "@/lib/queue/queues";
import { listJobsForPost } from "@/lib/db/tables/agent-jobs";
import { canUseListingCta, verifyStayForPost } from "./post-trust.service";

/**
 * post.service - deterministic social feed business rules.
 * Routes call this service; repositories only own SQL.
 */

export type CreateDraftInput = {
  tripId?: string | null;
  listingId?: string | null;
  bookingId?: string | null;
  title: string;
  caption?: string | null;
  body?: string | null;
  location?: string | null;
  destination?: string | null;
  mood?: string | null;
  tags?: string[];
  visibility?: "public" | "private";
  postType?: "text" | "photo" | "carousel" | "reel" | "trip_recap";
  media?: {
    mediaUrl: string;
    mediaKind?: "photo" | "video" | "reel";
    sortOrder?: number;
    cloudinaryPublicId?: string | null;
    width?: number | null;
    height?: number | null;
    durationSeconds?: number | null;
    aiDescription?: string | null;
  }[];
};

export type PostWithMedia = {
  post: TravelPostRow;
  media: PostMediaRow[];
};

function cleanTags(tags?: string[]) {
  return [...new Set((tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 12);
}

async function assertTripAccess(authorId: string, tripId?: string | null) {
  if (!tripId) return;
  const trip = await getTripForUser(tripId, authorId);
  if (!trip) throw new Error("Trip not found or not accessible.");
}

export async function createDraftPost(authorId: string, input: CreateDraftInput): Promise<PostWithMedia> {
  await assertTripAccess(authorId, input.tripId);

  const title = input.title.trim();
  if (!title) throw new Error("Post title is required.");

  const post = await createPostDraft({
    authorId,
    tripId: input.tripId,
    listingId: input.listingId,
    bookingId: input.bookingId,
    title,
    caption: input.caption,
    body: input.body,
    location: input.location,
    destination: input.destination,
    mood: input.mood,
    tags: cleanTags(input.tags),
    visibility: input.visibility ?? "public",
    postType: input.postType ?? ((input.media?.length ?? 0) > 1 ? "carousel" : input.media?.length ? "photo" : "text"),
    mediaUrl: input.media?.[0]?.mediaUrl ?? null
  });

  const mediaRows = [];
  for (const [index, item] of (input.media ?? []).entries()) {
    mediaRows.push(await addPostMedia({
      postId: post.id,
      mediaUrl: item.mediaUrl,
      mediaKind: item.mediaKind ?? "photo",
      sortOrder: item.sortOrder ?? index,
      cloudinaryPublicId: item.cloudinaryPublicId,
      width: item.width,
      height: item.height,
      durationSeconds: item.durationSeconds,
      aiDescription: item.aiDescription
    }));
  }

  return { post, media: mediaRows };
}

export async function publishPost(authorId: string, postId: string): Promise<TravelPostRow | null> {
  const post = await getTravelPostForAuthor(postId, authorId);
  if (!post) return null;

  if (post.moderation_status === "blocked" || post.status === "rejected") {
    throw new Error("This post cannot be published because moderation rejected it.");
  }

  const trust = await verifyStayForPost({
    authorId,
    listingId: post.listing_id,
    bookingId: post.booking_id
  });
  await setVerifiedStay(post.id, trust.verified);

  if (post.listing_id && !(await canUseListingCta(post.listing_id))) {
    throw new Error("Linked listing is not public.");
  }

  return updatePostStatus(postId, authorId, "published", post.moderation_status === "not_reviewed" ? "approved" : undefined);
}

export async function applyModerationResult(
  postId: string,
  input: {
    moderationStatus: "pending_review" | "approved" | "rejected" | "blocked";
    moderationReport?: Record<string, unknown>;
  }
): Promise<TravelPostRow | null> {
  return applyPostModeration(postId, {
    moderationStatus: input.moderationStatus,
    moderationReport: input.moderationReport,
    status: input.moderationStatus === "rejected" || input.moderationStatus === "blocked" ? "rejected" : undefined
  });
}

export async function applyComposeResult(
  authorId: string,
  postId: string,
  input: {
    caption: string;
    body?: string | null;
    mood?: string | null;
    tags: string[];
    destination?: string | null;
    aiSummary?: string | null;
    moderationStatus: "pending_review" | "approved" | "rejected" | "blocked";
    moderationReport?: Record<string, unknown>;
  }
): Promise<TravelPostRow | null> {
  const existing = await getTravelPostForAuthor(postId, authorId);
  if (!existing) return null;

  const blocked = input.moderationStatus === "rejected" || input.moderationStatus === "blocked";
  const nextStatus = blocked ? "rejected" : existing.status === "published" ? "published" : "pending_review";

  return applyPostComposeResult(postId, authorId, {
    ...input,
    tags: cleanTags(input.tags),
    status: nextStatus
  });
}

export async function enqueuePostCompose(authorId: string, postId: string) {
  const post = await getTravelPostForAuthor(postId, authorId);
  if (!post) return null;

  const job = await enqueueJob({
    type: "social_post",
    userId: authorId,
    idempotencyKey: `social-post-${postId}-${randomUUID()}`,
    input: { postId, authorId },
    attempts: 1
  });

  const updated = await setPostComposeJob(postId, authorId, job.id);
  return { post: updated ?? post, jobId: job.id };
}

export async function listPostComposeJobs(authorId: string, postId: string) {
  const post = await getTravelPostForAuthor(postId, authorId);
  if (!post) return null;
  return listJobsForPost(postId);
}

export async function editOwnPost(
  authorId: string,
  postId: string,
  patch: Parameters<typeof updatePostContent>[2]
): Promise<TravelPostRow | null> {
  return updatePostContent(postId, authorId, {
    ...patch,
    tags: patch.tags ? cleanTags(patch.tags) : undefined
  });
}

export async function deleteOwnPost(authorId: string, postId: string): Promise<TravelPostRow | null> {
  return softDeletePost(postId, authorId);
}

export async function getOwnPost(authorId: string, postId: string): Promise<PostWithMedia | null> {
  const post = await getTravelPostForAuthor(postId, authorId);
  if (!post) return null;
  return { post, media: await listPostMedia(post.id) };
}

export async function getVisiblePost(viewerId: string, postId: string): Promise<PostWithMedia | null> {
  const post = await getTravelPostById(postId);
  if (!post || post.status === "deleted") return null;

  const ownsPost = post.author_id === viewerId;
  const isPublic = post.status === "published" && post.visibility === "public";
  if (!ownsPost && !isPublic) return null;

  if (isPublic && !ownsPost) await incrementPostView(post.id);
  return { post, media: await listPostMedia(post.id) };
}

export async function listOwnPosts(authorId: string): Promise<TravelPostRow[]> {
  return listTravelPostsForAuthor(authorId);
}

async function canEngageWithPost(postId: string) {
  const post = await getTravelPostById(postId);
  return Boolean(post && post.status === "published" && post.visibility === "public");
}

export async function reactToPost(viewerId: string, postId: string, kind: PostReactionKind) {
  if (!(await canEngageWithPost(postId))) return null;
  return setPostReaction(postId, viewerId, kind);
}

export async function removeReaction(viewerId: string, postId: string): Promise<boolean> {
  if (!(await canEngageWithPost(postId))) return false;
  await removePostReaction(postId, viewerId);
  return true;
}

export async function saveVisiblePost(viewerId: string, postId: string, collectionName?: string) {
  if (!(await canEngageWithPost(postId))) return null;
  return savePost(postId, viewerId, collectionName);
}

export async function unsaveVisiblePost(viewerId: string, postId: string, collectionName?: string): Promise<boolean> {
  if (!(await canEngageWithPost(postId))) return false;
  await unsavePost(postId, viewerId, collectionName);
  return true;
}

export async function commentOnPost(viewerId: string, postId: string, body: string, parentId?: string | null) {
  if (!(await canEngageWithPost(postId))) return null;
  const clean = body.trim();
  if (!clean) throw new Error("Comment body is required.");
  return addPostComment({ postId, userId: viewerId, body: clean, parentId });
}

export async function listVisibleComments(postId: string): Promise<PostCommentRow[] | null> {
  if (!(await canEngageWithPost(postId))) return null;
  return listPostComments(postId);
}

export async function recordStayHereClick(viewerId: string, postId: string) {
  const post = await getTravelPostById(postId);
  if (!post || post.status !== "published" || post.visibility !== "public" || !post.listing_id) return null;
  if (!(await canUseListingCta(post.listing_id))) return null;
  return recordPostAttribution({
    postId,
    viewerId,
    listingId: post.listing_id,
    attributionType: "click"
  });
}
