import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/session";
import { getMemoryJobForOwner, listApprovals, listCriticVerdicts } from "@/lib/db/tables/memory-jobs";

export const runtime = "nodejs";

/** GET /api/memory/[id] — full job detail for the job console page. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler", "admin"]);
  if (auth.response) return auth.response;

  const { id } = await params;
  const job = await getMemoryJobForOwner(id, auth.session!.id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [approvals, verdicts] = await Promise.all([
    listApprovals(job.id).catch(() => []),
    listCriticVerdicts(job.id).catch(() => [])
  ]);

  // Live engine state (attempt counts, seal record) straight from the media-worker.
  let engine: unknown = null;
  try {
    const res = await fetch(
      `${process.env.MEDIA_WORKER_URL || "http://localhost:8000"}/jobs/${job.id}`,
      { signal: AbortSignal.timeout(5000), cache: "no-store" }
    );
    if (res.ok) engine = await res.json();
  } catch {
    engine = null; // engine offline is a UI state, not an error
  }

  return NextResponse.json({ job, approvals, verdicts, engine });
}
