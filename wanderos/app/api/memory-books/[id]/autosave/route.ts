import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/session";
import { autosaveDoc, snapshot } from "@/lib/services/memoryBook.service";
import type { MemoryBookDoc } from "@/lib/db/tables/memory-books";

export const runtime = "nodejs";

/** PATCH = debounced autosave; POST = explicit version snapshot. Owner-only. */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { doc?: MemoryBookDoc };
  if (!body.doc || !Array.isArray(body.doc.spreads)) return NextResponse.json({ error: "doc.spreads required" }, { status: 400 });
  const updated = await autosaveDoc(auth.session!.id, id, body.doc);
  if (!updated) return NextResponse.json({ error: "Memory book not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { doc?: MemoryBookDoc };
  const res = await snapshot(auth.session!.id, id, body.doc);
  if (!res) return NextResponse.json({ error: "Memory book not found." }, { status: 404 });
  return NextResponse.json(res);
}
