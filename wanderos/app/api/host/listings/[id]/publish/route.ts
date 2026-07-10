import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/session";
import { publish } from "@/lib/services/listing.service";

export const runtime = "nodejs";

/** POST /api/host/listings/[id]/publish — submit the draft for admin review (guarded transition). */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["host"]);
  if (auth.response) return auth.response;
  const { id } = await params;
  const r = await publish(id, auth.session!.id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ listing: r.listing });
}
