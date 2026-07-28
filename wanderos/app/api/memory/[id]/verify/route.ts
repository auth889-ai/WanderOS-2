import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/session";
import { getMemoryJobForOwner } from "@/lib/db/tables/memory-jobs";

export const runtime = "nodejs";

/**
 * GET /api/memory/[id]/verify — proxy the engine's three independent checks
 * (file hash vs sealed record, ed25519 signature, embedded manifest).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler", "admin"]);
  if (auth.response) return auth.response;

  const { id } = await params;
  const job = await getMemoryJobForOwner(id, auth.session!.id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    const res = await fetch(
      `${process.env.MEDIA_WORKER_URL || "http://localhost:8000"}/jobs/${job.id}/verify`,
      { signal: AbortSignal.timeout(30_000), cache: "no-store" }
    );
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "engine_unreachable" }, { status: 502 });
  }
}
