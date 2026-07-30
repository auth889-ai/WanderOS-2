import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { getMemoryJobForOwner } from "@/lib/db/tables/memory-jobs";
import { createShare, listSharesForJob, revokeShare } from "@/lib/db/tables/memory-shares";

export const runtime = "nodejs";

const CreateSchema = z.object({
  // "public" serves the sensitivity-filtered cut; "private" is the full family film.
  audience: z.enum(["public", "private"]).default("public"),
  expiresInDays: z.number().int().min(1).max(365).optional()
});

/** GET — links that already exist for this film. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler", "admin"]);
  if (auth.response) return auth.response;
  const { id } = await params;
  const job = await getMemoryJobForOwner(id, auth.session!.id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ shares: await listSharesForJob(job.id) });
}

/** POST — mint a share link. Only for a delivered film. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler", "admin"]);
  if (auth.response) return auth.response;

  const { id } = await params;
  const job = await getMemoryJobForOwner(id, auth.session!.id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (job.status !== "delivered") {
    // Sharing an unfinished film would hand out a link that 404s for the
    // recipient — worse than refusing.
    return NextResponse.json({ error: "not_delivered", status: job.status }, { status: 409 });
  }

  const parsed = CreateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const share = await createShare({
    jobId: job.id,
    audience: parsed.data.audience,
    createdBy: auth.session!.id,
    expiresInDays: parsed.data.expiresInDays
  });

  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:5050";
  return NextResponse.json({ share, url: `${base}/s/${share.token}` }, { status: 201 });
}

/** DELETE — revoke a link. Revoked, never deleted, so a leaked URL stays dead. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler", "admin"]);
  if (auth.response) return auth.response;
  const { id } = await params;
  const job = await getMemoryJobForOwner(id, auth.session!.id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const token = new URL(request.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "token_required" }, { status: 400 });

  const revoked = await revokeShare(token, auth.session!.id);
  return NextResponse.json({ revoked }, { status: revoked ? 200 : 404 });
}
