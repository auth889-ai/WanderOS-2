import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/session";
import { startListingVideo, listListingVideos, attachVideoToListing, type VideoType } from "@/lib/services/hostVideo.service";

export const runtime = "nodejs";

/** POST /api/host/listings/[id]/video — enqueue a promo-video render (Reel or Tour). 202 + ids.
 *  Progress streams over the existing /stream SSE (the job is an agent_jobs row for this listing). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["host"]);
  if (auth.response) return auth.response;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { type?: string; mode?: string; resolution?: string; narration?: string; musicMood?: string };

  const type: VideoType = body.type === "reel" ? "reel" : "tour";
  const resolution = body.resolution === "720p" ? "720p" : "1080p";
  const r = await startListingVideo(auth.session!.id, {
    listingId: id,
    type,
    mode: body.mode,
    resolution,
    narration: body.narration,
    musicMood: body.musicMood
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ videoId: r.videoId, jobId: r.jobId }, { status: 202 });
}

/** PATCH /api/host/listings/[id]/video — attach a finished video to the listing ({ videoId }). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["host"]);
  if (auth.response) return auth.response;
  const { id } = await params;
  const { videoId } = (await req.json().catch(() => ({}))) as { videoId?: string };
  if (!videoId) return NextResponse.json({ error: "videoId required" }, { status: 400 });
  const r = await attachVideoToListing(auth.session!.id, id, videoId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/** GET /api/host/listings/[id]/video — list this listing's videos (owner only). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["host"]);
  if (auth.response) return auth.response;
  const { id } = await params;
  const videos = await listListingVideos(auth.session!.id, id);
  return NextResponse.json({ videos });
}
