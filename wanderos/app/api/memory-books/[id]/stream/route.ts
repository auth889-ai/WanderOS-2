import { NextRequest } from "next/server";
import { requireApiRole } from "@/lib/auth/session";
import { getBook } from "@/lib/services/memoryBook.service";
import { getJob } from "@/lib/db/tables/agent-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** SSE: stream the book's build job progress until the book is ready/failed. Owner-only. */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  const { id } = await context.params;
  const book = await getBook(auth.session!.id, id);
  if (!book) return new Response("not found", { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const startedAt = Date.now();
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const b = await getBook(auth.session!.id, id);
          if (!b) { send({ error: "not found" }); break; }
          const job = b.agent_job_id ? await getJob(b.agent_job_id) : null;
          send({ status: b.status, progress: job?.progress ?? 0, stage: job?.current_stage ?? null });
          if (b.status === "ready" || b.status === "failed" || Date.now() - startedAt > 8 * 60 * 1000) break;
          await new Promise((r) => setTimeout(r, 1500));
        }
        send({ done: true });
      } catch (error) {
        send({ error: error instanceof Error ? error.message : String(error) });
      } finally {
        controller.close();
      }
    }
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
