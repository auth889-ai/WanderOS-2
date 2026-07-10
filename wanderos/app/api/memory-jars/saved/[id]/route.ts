import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/session";
import { renameJar, copyJar, deleteJar } from "@/lib/services/savedJar.service";

export const runtime = "nodejs";

/** PATCH {name} → rename */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  const { name } = await request.json().catch(() => ({ name: "" }));
  if (!name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  return NextResponse.json({ ok: await renameJar(auth.session!.id, (await params).id, name.trim()) });
}
/** POST → duplicate */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  const jar = await copyJar(auth.session!.id, (await params).id);
  return NextResponse.json({ jar });
}
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  await deleteJar(auth.session!.id, (await params).id);
  return NextResponse.json({ ok: true });
}
