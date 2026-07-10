import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { startStudioDraft, getHostListings } from "@/lib/services/listing.service";

export const runtime = "nodejs";

const CreateSchema = z.object({
  city: z.string().min(1),
  country: z.string().min(1),
  category: z.string().min(1),
  notes: z.string().default(""),
  photos: z.array(z.string()).default([]),
  submitId: z.string().uuid().optional() // idempotency: same submit → same draft/job
});

/** GET /api/host/listings — the host's own listings (dashboard). */
export async function GET() {
  const auth = await requireApiRole(["host"]);
  if (auth.response) return auth.response;
  const listings = await getHostListings(auth.session!.id);
  return NextResponse.json({ listings });
}

/** POST /api/host/listings — start a draft: create the row + enqueue the studio crew job (async). */
export async function POST(req: NextRequest) {
  const auth = await requireApiRole(["host"]);
  if (auth.response) return auth.response;
  const parsed = CreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { listing, jobId } = await startStudioDraft(auth.session!.id, parsed.data);
  // 202 Accepted — the crew runs on the worker; the client subscribes to /[id]/stream for progress
  return NextResponse.json({ listingId: listing.id, jobId, status: listing.status }, { status: 202 });
}
