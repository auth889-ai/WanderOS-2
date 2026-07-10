import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/session";
import { getMovie, deleteMovie, stopMovie } from "@/lib/services/memoryMovie.service";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  const movie = await getMovie(auth.session!.id, (await params).id);
  if (!movie) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ movie });
}

/** PATCH → stop the render (cancel, keep row). */
export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  const ok = await stopMovie(auth.session!.id, (await params).id);
  return NextResponse.json({ ok });
}

/** DELETE → cancel (if running) + delete the movie. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  const ok = await deleteMovie(auth.session!.id, (await params).id);
  return NextResponse.json({ ok });
}
