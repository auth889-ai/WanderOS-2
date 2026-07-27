import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { createMemoryJob, listMemoryJobsForOwner } from "@/lib/db/tables/memory-jobs";

export const runtime = "nodejs";

const CreateSchema = z.object({
  requestText: z.string().trim().min(3).max(2000),
  tripId: z.string().uuid().optional()
});

export async function GET() {
  const auth = await requireApiRole(["traveler", "admin"]);
  if (auth.response) return auth.response;
  const jobs = await listMemoryJobsForOwner(auth.session!.id);
  return NextResponse.json({ jobs });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(["traveler", "admin"]);
  if (auth.response) return auth.response;

  const parsed = CreateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const job = await createMemoryJob({
    ownerId: auth.session!.id,
    tripId: parsed.data.tripId ?? null,
    requestText: parsed.data.requestText
  });
  return NextResponse.json({ job }, { status: 201 });
}
