import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { startBuild, listBooks } from "@/lib/services/memoryBook.service";

export const runtime = "nodejs";

const CreateSchema = z.object({
  tripId: z.string().uuid().nullable().optional(),
  title: z.string().trim().max(120).optional(),
  photos: z.array(z.object({ url: z.string().url(), description: z.string().max(500).optional() })).max(120).optional()
});

/** POST → create + enqueue a build. GET → the traveler's books. Traveler-only. */
export async function POST(request: NextRequest) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  const parsed = CreateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const res = await startBuild(auth.session!.id, { tripId: parsed.data.tripId ?? null, title: parsed.data.title, photos: parsed.data.photos });
  return NextResponse.json(res, { status: 202 });
}

export async function GET() {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  const books = await listBooks(auth.session!.id);
  return NextResponse.json({ books });
}
