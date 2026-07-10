import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { getTravelProfile, saveTravelProfile } from "@/lib/db/tables/travel-profiles";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  const profile = await getTravelProfile(auth.session!.id);
  return NextResponse.json({ profile });
}

const SaveSchema = z.object({
  budget: z.string().max(40).nullable().optional(),
  interests: z.array(z.string().max(30)).max(12).optional(),
  homeCountry: z.string().max(40).nullable().optional(),
  lastQuery: z.string().max(200).nullable().optional()
});

export async function PUT(request: NextRequest) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  const parsed = SaveSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  await saveTravelProfile(auth.session!.id, parsed.data);
  return NextResponse.json({ ok: true });
}
