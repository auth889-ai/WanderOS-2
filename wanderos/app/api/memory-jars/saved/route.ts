import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { saveJar, listJars } from "@/lib/services/savedJar.service";

export const runtime = "nodejs";
const Schema = z.object({
  name: z.string().min(1).max(60),
  mode: z.enum(["image", "code"]),
  jarSrc: z.string().max(500).nullable().optional(),
  sceneUrl: z.string().url().nullable().optional(),
  movieUrl: z.string().url().nullable().optional(),
  movieId: z.string().uuid().nullable().optional()
});

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  const parsed = Schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Give your jar a name." }, { status: 400 });
  return NextResponse.json({ jar: await saveJar(auth.session!.id, parsed.data) });
}
export async function GET() {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  return NextResponse.json({ jars: await listJars(auth.session!.id) });
}
