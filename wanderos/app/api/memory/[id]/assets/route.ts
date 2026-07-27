import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { appendAssetKeys, getMemoryJobForOwner } from "@/lib/db/tables/memory-jobs";
import { objectExists, presignDownload } from "@/lib/media/b2";

export const runtime = "nodejs";

const ConfirmSchema = z.object({
  keys: z.array(z.string().min(1)).min(1).max(100)
});

/** POST — confirm uploaded keys (verifies each object actually landed in B2). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler", "admin"]);
  if (auth.response) return auth.response;

  const { id } = await params;
  const job = await getMemoryJobForOwner(id, auth.session!.id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = ConfirmSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const prefix = `trips/${job.id}/originals/`;
  const invalid = parsed.data.keys.filter((k) => !k.startsWith(prefix));
  if (invalid.length > 0) {
    return NextResponse.json({ error: "keys_outside_job_prefix", invalid }, { status: 400 });
  }

  const checks = await Promise.all(parsed.data.keys.map(async (k) => ((await objectExists(k)) ? k : null)));
  const confirmed = checks.filter((k): k is string => k !== null);
  const missing = parsed.data.keys.filter((k) => !confirmed.includes(k));

  if (confirmed.length > 0) await appendAssetKeys(job.id, confirmed);
  return NextResponse.json({ confirmed, missing });
}

/** GET — list this job's assets with click-time presigned view URLs (never stored). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler", "admin"]);
  if (auth.response) return auth.response;

  const { id } = await params;
  const job = await getMemoryJobForOwner(id, auth.session!.id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const assets = await Promise.all(
    job.asset_keys.map(async (key) => ({ key, url: await presignDownload(key) }))
  );
  return NextResponse.json({ assets });
}
