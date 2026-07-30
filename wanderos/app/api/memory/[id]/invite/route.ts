import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { getMemoryJobForOwner } from "@/lib/db/tables/memory-jobs";
import {
  createInvite,
  listContributors,
  removeContributor,
  setConsent
} from "@/lib/db/tables/memory-contributors";

export const runtime = "nodejs";

const CreateSchema = z.object({
  label: z.string().max(80).optional(),
  maxUses: z.number().int().min(1).max(100).optional(),
  expiresInDays: z.number().int().min(1).max(90).optional()
});

/** GET — who has contributed, and with what consent. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler", "admin"]);
  if (auth.response) return auth.response;
  const { id } = await params;
  const job = await getMemoryJobForOwner(id, auth.session!.id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ contributors: await listContributors(job.id) });
}

/** POST — mint an invite link for the rest of the group. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler", "admin"]);
  if (auth.response) return auth.response;
  const { id } = await params;
  const job = await getMemoryJobForOwner(id, auth.session!.id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = CreateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const invite = await createInvite({
    jobId: job.id,
    createdBy: auth.session!.id,
    label: parsed.data.label,
    maxUses: parsed.data.maxUses,
    expiresInDays: parsed.data.expiresInDays ?? 14
  });
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:5050";
  return NextResponse.json(
    { invite, url: `${base}/join/${invite.token}` },
    { status: 201 }
  );
}

const PatchSchema = z.object({
  contributorId: z.string().uuid(),
  consent: z.enum(["public", "private_only", "withdrawn"])
});

/** PATCH — change one contributor's consent. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler", "admin"]);
  if (auth.response) return auth.response;
  const { id } = await params;
  const job = await getMemoryJobForOwner(id, auth.session!.id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = PatchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const updated = await setConsent(job.id, parsed.data.contributorId, parsed.data.consent);
  return NextResponse.json({ contributor: updated }, { status: updated ? 200 : 404 });
}

/**
 * DELETE — remove a contributor and everything they supplied.
 *
 * Withdrawal is retroactive by design: someone who leaves takes their photos
 * with them, including out of a film that was already planned. The excluded
 * keys are returned so the caller can re-plan without them.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler", "admin"]);
  if (auth.response) return auth.response;
  const { id } = await params;
  const job = await getMemoryJobForOwner(id, auth.session!.id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const contributorId = new URL(request.url).searchParams.get("contributorId");
  if (!contributorId) return NextResponse.json({ error: "contributorId_required" }, { status: 400 });

  const result = await removeContributor(job.id, contributorId);
  return NextResponse.json(result, { status: result.removed ? 200 : 404 });
}
