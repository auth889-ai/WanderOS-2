import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Command } from "@langchain/langgraph";
import { requireApiRole } from "@/lib/auth/session";
import { getMemoryJobForOwner, recordApproval, updateMemoryJob, appendProgress } from "@/lib/db/tables/memory-jobs";
import { putJson, tripKey, isB2Configured } from "@/lib/media/b2";

export const runtime = "nodejs";
export const maxDuration = 60;

const Schema = z.object({
  // claim id -> the traveler's answer. Only "confirmed" can license a recreation.
  decisions: z.record(z.string(), z.enum(["confirmed", "denied", "unsure"]))
});

/**
 * POST /api/memory/[id]/consent — resume the truth-boundary checkpoint.
 *
 * The graph paused because some moments are in the itinerary or a voice note but
 * no photo proves them. This is the only path by which a claim becomes
 * USER_CONFIRMED, so the answers are recorded to B2 as a consent audit trail
 * before the graph resumes.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler", "admin"]);
  if (auth.response) return auth.response;

  const { id } = await params;
  const job = await getMemoryJobForOwner(id, auth.session!.id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (job.status !== "awaiting_consent") {
    return NextResponse.json({ error: "not_awaiting_consent", status: job.status }, { status: 409 });
  }

  const parsed = Schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { decisions } = parsed.data;

  let b2Key: string | null = null;
  if (isB2Configured()) {
    b2Key = tripKey(job.id, "consent", "decisions.json");
    await putJson(b2Key, {
      decisions,
      actor: auth.session!.id,
      at: new Date().toISOString()
    }).catch(() => (b2Key = null));
  }
  await recordApproval({
    jobId: job.id,
    checkpoint: "consent",
    decision: "answered",
    payload: { decisions },
    actorId: auth.session!.id,
    b2Key
  });
  await updateMemoryJob(job.id, { consent_decisions: decisions, status: "planning" });
  await appendProgress(
    job.id,
    { event: "checkpoint.consent.answered", confirmed: Object.values(decisions).filter((d) => d === "confirmed").length },
    "planning",
    42
  );

  // Resume detached — planning and generation run long; the UI follows via SSE.
  const { buildAutopilotGraph, getCheckpointer } = await import("@/lib/agents/crews/memory-autopilot/graph");
  const graph = buildAutopilotGraph(await getCheckpointer());
  void graph
    .invoke(new Command({ resume: decisions }), {
      configurable: { thread_id: job.id },
      recursionLimit: 25
    })
    .catch(async (e) => {
      await updateMemoryJob(job.id, { status: "failed", error: String(e).slice(0, 500) });
      await appendProgress(job.id, { event: "agent.failed", error: String(e).slice(0, 300) }, "failed", 45);
    });

  return NextResponse.json({ status: "resumed", answered: Object.keys(decisions).length });
}
