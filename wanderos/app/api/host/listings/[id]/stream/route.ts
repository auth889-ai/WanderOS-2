import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/session";
import { listJobsForListing } from "@/lib/db/tables/agent-jobs";
import { getListing } from "@/lib/services/listing.service";

export const dynamic = "force-dynamic"; // SSE must not be cached/statically optimized
export const runtime = "nodejs";

/**
 * GET /api/host/listings/[id]/stream — Server-Sent Events of the listing's job progress.
 * Polls the agent_jobs rows (the worker writes progress there) and pushes them to the host UI until
 * every job is terminal. This is the live "watch the crew work" feed. Read-only; no AI here.
 * RBAC: host role AND ownership — a host may only stream their OWN listing's jobs.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["host"]);
  if (auth.response) return auth.response;
  const { id } = await params;

  // ownership: the listing must belong to this host (otherwise no peeking at someone else's draft)
  const owned = await getListing(id);
  if (!owned || owned.host_id !== auth.session!.id) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const encoder = new TextEncoder();
  const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const startedAt = Date.now();
      const MAX_MS = 10 * 60 * 1000;
      try {
        // keep streaming until all jobs for this listing are terminal (or we hit the cap)
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const rows = await listJobsForListing(id);
          const jobs = rows.map((j) => ({
            id: j.id,
            type: j.type,
            status: j.status,
            progress: j.progress,
            stage: j.current_stage,
            error: j.error,
            output: j.status === "succeeded" ? j.output : undefined
          }));
          send({ jobs });

          const allTerminal = jobs.length > 0 && jobs.every((j) => TERMINAL.has(j.status));
          if (allTerminal || Date.now() - startedAt > MAX_MS) break;
          await new Promise((r) => setTimeout(r, 1500));
        }
        send({ done: true });
      } catch (err) {
        send({ error: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
