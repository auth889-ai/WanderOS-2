import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/session";
import { listPostComposeJobs } from "@/lib/services/post.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const initialJobs = await listPostComposeJobs(auth.session!.id, id);
  if (!initialJobs) return NextResponse.json({ error: "Post not found or not accessible." }, { status: 404 });

  const encoder = new TextEncoder();
  const terminal = new Set(["succeeded", "failed", "cancelled"]);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const startedAt = Date.now();
      const maxMs = 10 * 60 * 1000;

      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const rows = await listPostComposeJobs(auth.session!.id, id);
          if (!rows) {
            send({ error: "Post not found or not accessible." });
            break;
          }

          const jobs = rows.map((job) => ({
            id: job.id,
            type: job.type,
            status: job.status,
            progress: job.progress,
            stage: job.current_stage,
            error: job.error,
            output: job.status === "succeeded" ? job.output : undefined
          }));
          send({ jobs });

          const allTerminal = jobs.length > 0 && jobs.every((job) => terminal.has(job.status));
          if (allTerminal || Date.now() - startedAt > maxMs) break;
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        send({ done: true });
      } catch (error) {
        send({ error: error instanceof Error ? error.message : String(error) });
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
