import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/session";
import { getMemoryJobForOwner, updateMemoryJob } from "@/lib/db/tables/memory-jobs";

export const runtime = "nodejs";

/**
 * POST /api/memory/[id]/start — hand the collected assets to the Autopilot agent.
 * Validates the job is startable, then flips it to the pipeline. The BullMQ →
 * LangGraph handoff attaches here (worker/handlers/memoryPipeline.ts, Phase 2/4).
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler", "admin"]);
  if (auth.response) return auth.response;

  const { id } = await params;
  const job = await getMemoryJobForOwner(id, auth.session!.id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (job.status !== "intake") {
    return NextResponse.json({ error: "already_started", status: job.status }, { status: 409 });
  }
  const photoish = job.asset_keys.filter((k) => !k.endsWith(".pdf"));
  if (photoish.length < 3) {
    return NextResponse.json(
      { error: "not_enough_assets", message: "Upload at least 3 photos or clips before starting." },
      { status: 400 }
    );
  }

  const updated = await updateMemoryJob(job.id, { status: "collecting" });

  const { enqueueJob } = await import("@/lib/queue/queues");
  await enqueueJob({
    type: "memory_autopilot",
    userId: auth.session!.id,
    idempotencyKey: `memory_autopilot:${job.id}`,
    input: { memoryJobId: job.id }
  });

  return NextResponse.json({ job: updated, status: updated?.status }, { status: 202 });
}
