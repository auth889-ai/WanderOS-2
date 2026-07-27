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

  // Stage 2 — understanding: EXIF + vision timeline (the LangGraph graph attaches here next)
  await updateMemoryJob(memoryJobId, { status: "understanding" });
  await appendProgress(memoryJobId, { event: "stage.started", stage: "understanding" }, "understanding", 25);
  await ctx.reportProgress(25, "Understanding your trip");

  // Stage 3 — planning: story planner (graph node lands next build step)
  await updateMemoryJob(memoryJobId, { status: "planning" });
  await appendProgress(memoryJobId, { event: "stage.started", stage: "planning" }, "planning", 45);
  await ctx.reportProgress(45, "Planning the story");

  // Pause for the human — storyboard checkpoint (interrupt() takes over when the graph lands)
  await updateMemoryJob(memoryJobId, { status: "awaiting_storyboard_approval" });
  await appendProgress(
    memoryJobId,
    { event: "checkpoint.reached", checkpoint: "storyboard" },
    "awaiting_storyboard_approval",
    50
  );
  await ctx.reportProgress(50, "Waiting for your storyboard approval");

  return { memoryJobId, engineOk, assets: job.asset_keys.length, pausedAt: "storyboard" };
};
