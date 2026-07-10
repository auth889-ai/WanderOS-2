import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { saveVisiblePost, unsaveVisiblePost } from "@/lib/services/post.service";

export const runtime = "nodejs";

const SaveSchema = z.object({
  collectionName: z.string().trim().min(1).max(80).optional()
});

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;

  const parsed = SaveSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { id } = await context.params;
  const save = await saveVisiblePost(auth.session!.id, id, parsed.data.collectionName);
  if (!save) return NextResponse.json({ error: "Post not found or not visible." }, { status: 404 });
  return NextResponse.json({ save });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;

  const parsed = SaveSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { id } = await context.params;
  const ok = await unsaveVisiblePost(auth.session!.id, id, parsed.data.collectionName);
  if (!ok) return NextResponse.json({ error: "Post not found or not visible." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
