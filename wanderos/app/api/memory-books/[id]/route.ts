import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/session";
import { getBook } from "@/lib/services/memoryBook.service";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  const { id } = await context.params;
  const book = await getBook(auth.session!.id, id);
  if (!book) return NextResponse.json({ error: "Memory book not found." }, { status: 404 });
  return NextResponse.json({ book });
}
