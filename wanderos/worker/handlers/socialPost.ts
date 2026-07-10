import { JobHandler } from "@/lib/queue/runner";
import { runSocialPostCrew } from "@/lib/agents/crews/social-post";
import { getOwnPost, applyComposeResult } from "@/lib/services/post.service";
import { verifyStayForPost } from "@/lib/services/post-trust.service";

type SocialPostJobInput = {
  postId?: string;
  authorId?: string;
};

const STAGE_PROGRESS: Record<string, { progress: number; message: string }> = {
  "shot-vision": { progress: 25, message: "Analyzing traveler media" },
  "caption-writer": { progress: 45, message: "Writing social post draft" },
  tagger: { progress: 62, message: "Creating discovery tags" },
  moderation: { progress: 78, message: "Checking safety and honesty" },
  embedder: { progress: 90, message: "Embedding post for pgvector discovery" }
};

export const socialPostHandler: JobHandler = async (ctx) => {
  const input = ctx.input as SocialPostJobInput;
  if (!input.postId || !input.authorId) {
    throw new Error("social_post job requires postId and authorId.");
  }

  await ctx.reportProgress(8, "Preparing social post compose crew");
  await ctx.throwIfCancelled();

  const own = await getOwnPost(input.authorId, input.postId);
  if (!own) throw new Error("Post not found or not accessible for compose.");

  const trust = await verifyStayForPost({
    authorId: input.authorId,
    listingId: own.post.listing_id,
    bookingId: own.post.booking_id
  });

  const { runId, result } = await runSocialPostCrew(
    {
      postId: own.post.id,
      authorId: input.authorId,
      title: own.post.title,
      caption: own.post.caption,
      body: own.post.body,
      location: own.post.location,
      destination: own.post.destination,
      mood: own.post.mood,
      tags: own.post.tags ?? [],
      listingId: own.post.listing_id,
      bookingId: own.post.booking_id,
      verifiedStay: trust.verified,
      media: own.media.map((media) => ({
        id: media.id,
        mediaUrl: media.media_url,
        mediaKind: media.media_kind,
        aiDescription: media.ai_description
      }))
    },
    async (step) => {
      const stage = STAGE_PROGRESS[step.name] ?? { progress: 50, message: `Completed ${step.name}` };
      await ctx.reportProgress(stage.progress, stage.message);
      await ctx.throwIfCancelled();
    }
  );

  await ctx.reportProgress(94, "Saving composed social post");
  await ctx.throwIfCancelled();

  const updated = await applyComposeResult(input.authorId, input.postId, {
    caption: result.caption,
    body: result.body,
    mood: result.mood,
    tags: result.tags,
    destination: result.destination,
    aiSummary: result.aiSummary,
    moderationStatus: result.moderationStatus,
    moderationReport: result.moderationReport
  });

  if (!updated) throw new Error("Unable to save composed social post.");

  return {
    postId: input.postId,
    authorId: input.authorId,
    runId,
    status: "compose_ready",
    moderationStatus: result.moderationStatus,
    embedded: result.embedded,
    tagCount: result.tags.length
  };
};
