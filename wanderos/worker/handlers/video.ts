import { JobHandler } from "@/lib/queue/runner";
import { runListingVideo } from "@/lib/agents/video/orchestrator";
import { MotionRouter } from "@/lib/agents/video/providers/motion";
import { setVideoStatus, setVideoReady } from "@/lib/db/tables/listing-videos";
import { queryAurora } from "@/lib/db/pool";
import type { VideoBrief } from "@/lib/agents/video/types";

/**
 * listing_video handler — runs the multi-agent video crew + render as a worker job.
 * Streams stage/shot progress to agent_jobs (→ SSE), updates the listing_videos manifest, and on
 * success writes listings.tour (the fast read pointer). Motion = Kling→Veo (premium only).
 */
type VideoJobInput = {
  videoId: string;
  listingId: string;
  type: "tour" | "reel";
  brief: VideoBrief;
  listingTitle?: string;
  city?: string;
  narrate: boolean;
};

const STAGE_PCT: Record<string, number> = { planning: 8, narration: 32, composing: 86, publishing: 95, ready: 100 };

export const videoHandler: JobHandler = async (ctx) => {
  const input = ctx.input as unknown as VideoJobInput;
  const { videoId } = input;

  try {
    const result = await runListingVideo({
      brief: input.brief,
      listingTitle: input.listingTitle,
      city: input.city,
      narrate: input.narrate,
      router: MotionRouter.premium(), // Kling → Veo (no shaky Ken-Burns)
      onProgress: async (stage, detail) => {
        let pct = STAGE_PCT[stage] ?? 50;
        if (stage === "rendering" && detail?.shot && detail?.of) {
          pct = 40 + Math.round((Number(detail.shot) / Number(detail.of)) * 40);
        }
        const label =
          stage === "agent" ? `Agent · ${detail?.agent}` :
          stage === "rendering" ? `Rendering shot ${detail?.shot}/${detail?.of}` :
          stage.charAt(0).toUpperCase() + stage.slice(1);
        await ctx.reportProgress(Math.min(99, pct), label);
        await ctx.throwIfCancelled();
        await setVideoStatus(videoId, stage === "agent" ? "planning" : stage).catch(() => {});
      }
    });

    await setVideoReady(videoId, {
      url: result.url,
      thumbnailUrl: result.thumbnailUrl,
      durationSec: result.durationSec,
      manifest: result.manifest as unknown as Record<string, unknown>,
      costCents: result.costCents
    });
    // denormalized pointer for fast read pages (detail / marketplace)
    await queryAurora(`update listings set tour=$2::jsonb, updated_at=now() where id=$1`, [
      input.listingId,
      JSON.stringify({ video_id: videoId, type: input.type, url: result.url, thumbnail: result.thumbnailUrl, status: "ready" })
    ]).catch(() => {});

    return { videoId, url: result.url, thumbnailUrl: result.thumbnailUrl, durationSec: result.durationSec, title: result.title };
  } catch (e) {
    await setVideoStatus(videoId, "failed", e instanceof Error ? e.message : String(e)).catch(() => {});
    throw e;
  }
};
