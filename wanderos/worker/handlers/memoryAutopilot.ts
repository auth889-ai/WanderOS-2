import { JobHandler } from "@/lib/queue/runner";
import { appendProgress, getMemoryJob, updateMemoryJob } from "@/lib/db/tables/memory-jobs";

/**
 * memory_autopilot handler — the bridge between the queue and the Autopilot pipeline.
 * House pattern: every step writes progress into the memory_jobs row (→ SSE route polls it).
 *
 * Current stage coverage (grows as phases land):
 *   collecting → understanding (media-worker EXIF/vision — next build step wires the graph)
 *   → planning → awaiting_storyboard_approval
 * The LangGraph supervisor replaces the inline stubs; this handler stays the durable entry.
 */

const MEDIA_WORKER_URL = process.env.MEDIA_WORKER_URL || "http://localhost:8000";

export const memoryAutopilotHandler: JobHandler = async (ctx) => {
  const memoryJobId = String(ctx.input.memoryJobId ?? "");
  if (!memoryJobId) throw new Error("memory_autopilot job missing memoryJobId");

  const job = await getMemoryJob(memoryJobId);
  if (!job) throw new Error(`memory job ${memoryJobId} not found`);

  // Stage 1 — collecting: verify assets + engine availability
  await updateMemoryJob(memoryJobId, { status: "collecting" });
  await appendProgress(memoryJobId, { event: "stage.started", stage: "collecting" }, "collecting", 5);
  await ctx.reportProgress(5, "Collecting your trip");

  let engineOk = false;
  try {
    const res = await fetch(`${MEDIA_WORKER_URL}/health`, { signal: AbortSignal.timeout(5000) });
    engineOk = res.ok;
    const health = res.ok ? await res.json() : null;
    await appendProgress(memoryJobId, {
      event: "engine.health",
      ok: engineOk,
      tier: health?.tier,
      b2: health?.b2_configured
    });
  } catch {
    await appendProgress(memoryJobId, { event: "engine.health", ok: false, detail: "media-worker unreachable" });
  }

  const photoish = job.asset_keys.filter((k) => !k.endsWith(".pdf"));
  await appendProgress(
    memoryJobId,
    { event: "assets.collected", photos: photoish.length, pdfs: job.asset_keys.length - photoish.length },
    "collecting",
    15
  );

  // Run the LangGraph brain up to the durable storyboard checkpoint.
  // thread_id = memoryJobId → the pause survives restarts (Postgres checkpointer).
  const { buildAutopilotGraph, getCheckpointer } = await import("@/lib/agents/crews/memory-autopilot/graph");
  const graph = buildAutopilotGraph(await getCheckpointer());
  await ctx.reportProgress(20, "Agent understanding your trip");
  await graph.invoke(
    {
      jobId: memoryJobId,
      requestText: job.request_text,
      assetKeys: job.asset_keys,
      inferred: null,
      timeline: null,
      gaps: [],
      storyboard: null,
      approval: null
    },
    { configurable: { thread_id: memoryJobId }, recursionLimit: 25 }
  );
  // invoke() returns when the graph hits interrupt() — job row is already at
  // awaiting_storyboard_approval with the storyboard persisted.
  await ctx.reportProgress(65, "Waiting for your storyboard approval");
  return { memoryJobId, engineOk, assets: job.asset_keys.length, pausedAt: "storyboard" };
};
