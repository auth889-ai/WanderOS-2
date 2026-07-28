import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Command } from "@langchain/langgraph";
import { requireApiRole } from "@/lib/auth/session";
import { getMemoryJobForOwner, recordApproval, updateMemoryJob, appendProgress } from "@/lib/db/tables/memory-jobs";
import { putJson, tripKey, isB2Configured } from "@/lib/media/b2";

export const runtime = "nodejs";
export const maxDuration = 60;

const ApproveSchema = z.object({
  decision: z.enum(["approved", "edited", "rejected"]),
  consents: z.record(z.coerce.number(), z.boolean()).optional(), // sceneIdx -> consent
  editedStoryboard: z.unknown().optional(),
  notes: z.string().max(2000).optional()
});

/**
 * POST /api/memory/[id]/approve — resume the DURABLE storyboard checkpoint.
 * The graph paused at interrupt(); Command({resume}) continues it with the human's
 * decision. Approval recorded to DB + mirrored to B2 approvals/ (audit trail).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler", "admin"]);
  if (auth.response) return auth.response;

  const { id } = await params;
  const job = await getMemoryJobForOwner(id, auth.session!.id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (job.status !== "awaiting_storyboard_approval") {
    return NextResponse.json({ error: "not_awaiting_approval", status: job.status }, { status: 409 });
  }

  const parsed = ApproveSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { decision, consents, editedStoryboard, notes } = parsed.data;

  // audit trail: DB row + B2 mirror (best-effort when B2 not yet configured)
  let b2Key: string | null = null;
  if (isB2Configured()) {
    b2Key = tripKey(job.id, "approvals", `storyboard-v${job.storyboard_version}.json`);
    await putJson(b2Key, { decision, consents, notes, actor: auth.session!.id, at: new Date().toISOString() }).catch(
      () => (b2Key = null)
    );
  }
  await recordApproval({
    jobId: job.id,
    checkpoint: "storyboard",
    decision,
    payload: { consents, notes, editedStoryboard: Boolean(editedStoryboard) },
    actorId: auth.session!.id,
    b2Key
  });

  if (decision === "rejected") {
    await updateMemoryJob(job.id, { status: "failed", error: `storyboard rejected: ${notes ?? "no reason"}` });
    await appendProgress(job.id, { event: "checkpoint.rejected" }, "failed", 65);
    return NextResponse.json({ status: "rejected" });
  }

  if (editedStoryboard) {
    await updateMemoryJob(job.id, {
      storyboard: editedStoryboard as Record<string, unknown>,
      storyboard_version: job.storyboard_version + 1
    });
  }

  await updateMemoryJob(job.id, { status: "generating" });
  await appendProgress(job.id, { event: "checkpoint.approved", consents }, "generating", 70);

  // Resume the paused graph on its durable thread. generate_film polls the render
  // engine for up to 30 min, so the resume runs detached — progress reaches the UI
  // via the SSE stream, and the engine's own state survives in B2 regardless.
  const { buildAutopilotGraph, getCheckpointer } = await import("@/lib/agents/crews/memory-autopilot/graph");
  const graph = buildAutopilotGraph(await getCheckpointer());
  void graph
    .invoke(new Command({ resume: { decision, consents } }), {
      configurable: { thread_id: job.id },
      recursionLimit: 25
    })
    .catch(async (e) => {
      await updateMemoryJob(job.id, { status: "failed", error: String(e).slice(0, 500) });
      await appendProgress(job.id, { event: "agent.generate.failed", error: String(e).slice(0, 300) }, "failed", 75);
    });

  return NextResponse.json({ status: "resumed", decision });
}
