import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { startMovie, listMovies } from "@/lib/services/memoryMovie.service";

export const runtime = "nodejs";

const StartSchema = z.object({
  title: z.string().max(80).optional(),
  story: z.string().max(2000).optional(),
  photos: z.array(z.string().url()).max(12).optional(),
  source: z.enum(["past", "upload", "text"]).optional(),
  tier: z.enum(["free", "cinematic"]).optional()   // "cinematic" = paid fal/Veo; default = free Ken-Burns
});

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  const parsed = StartSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { movieId, jobId } = await startMovie(auth.session!.id, parsed.data);
  return NextResponse.json({ movieId, jobId });
}

export async function GET() {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  return NextResponse.json({ movies: await listMovies(auth.session!.id) });
}
