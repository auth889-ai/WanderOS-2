import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/session";
import { getMemoryJobForOwner } from "@/lib/db/tables/memory-jobs";

export const dynamic = "force-dynamic"; // SSE must not be cached/statically optimized
export const runtime = "nodejs";

const TERMINAL = new Set(["delivered", "failed", "awaiting_storyboard_approval", "awaiting_final_approval"]);

/**
 * GET /api/memory/[id]/stream — SSE of the Autopilot job's progress.
 * House pattern (see FEATURE_ARCHITECTURE_DIAGRAMS.md): the worker writes progress
 * into the memory_jobs row; this route POLLS the row and pushes it. Read-only; no AI.
 * Streams until the job reaches a terminal or approval-pause state.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler", "admin"]);
  if (auth.response) return auth.response;
  const { id } = await params;

  const owned = await getMemoryJobForOwner(id, auth.session!.id);
  if (!owned) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const startedAt = Date.now();
      const MAX_MS = 10 * 60 * 1000;
      let lastLen = -1;
      let lastStatus = "";
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const job = await getMemoryJobForOwner(id, auth.session!.id);
          if (!job) break;
          const progress = (job.progress as unknown[]) ?? [];
          if (progress.length !== lastLen || job.status !== lastStatus) {
            lastLen = progress.length;
            lastStatus = job.status;
            send({
              status: job.status,
              stage: job.current_stage,
              pct: job.progress_pct,
              events: progress.slice(-30)
            });
          }
          if (TERMINAL.has(job.status) || Date.now() - startedAt > MAX_MS) break;
          await new Promise((r) => setTimeout(r, 1200));
        }
      } finally {
        controller.close();
      }
    }
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
