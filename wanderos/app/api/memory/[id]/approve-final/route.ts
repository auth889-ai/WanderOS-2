import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Command } from "@langchain/langgraph";
import { requireApiRole } from "@/lib/auth/session";
import { getMemoryJobForOwner, recordApproval, updateMemoryJob, appendProgress } from "@/lib/db/tables/memory-jobs";
import { putJson, tripKey, isB2Configured } from "@/lib/media/b2";

export const runtime = "nodejs";
export const maxDuration = 60;

const Schema = z.object({
  decision: z.enum(["approved", "rejected"]),
  notes: z.string().max(2000).optional()
});

/**
 * POST /api/memory/[id]/approve-final — resume the second DURABLE checkpoint.
 * The graph paused at interrupt({checkpoint: "final"}) after the sealed film was
 * delivered by the render engine; this records the human verdict and resumes into
 * the deliver node (fast — no generation happens after this point).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler", "admin"]);
  if (auth.response) return auth.response;

  const { id } = await params;
  const job = await getMemoryJobForOwner(id, auth.session!.id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (job.status !== "awaiting_final_approval") {
    return NextResponse.json({ error: "not_awaiting_final", status: job.status }, { status: 409 });
  }

  const parsed = Schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { decision, notes } = parsed.data;

  let b2Key: string | null = null;
  if (isB2Configured()) {
    b2Key = tripKey(job.id, "approvals", "final.json");
    await putJson(b2Key, { decision, notes, actor: auth.session!.id, at: new Date().toISOString() }).catch(
      () => (b2Key = null)
    );
  }
  await recordApproval({
    jobId: job.id,
    checkpoint: "final",
    decision,
    payload: { notes },
    actorId: auth.session!.id,
    b2Key
  });

  if (decision === "rejected") {
    await updateMemoryJob(job.id, { status: "failed", error: `final approval rejected: ${notes ?? "no reason"}` });
    await appendProgress(job.id, { event: "checkpoint.final.rejected" }, "failed", 92);
    return NextResponse.json({ status: "rejected" });
  }

  const { buildAutopilotGraph, getCheckpointer } = await import("@/lib/agents/crews/memory-autopilot/graph");
  const graph = buildAutopilotGraph(await getCheckpointer());
  await graph.invoke(new Command({ resume: { decision } }), {
    configurable: { thread_id: job.id },
    recursionLimit: 25
  });

  return NextResponse.json({ status: "delivered" });
}
