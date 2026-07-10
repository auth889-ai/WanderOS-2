import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { reactToPost, removeReaction } from "@/lib/services/post.service";

export const runtime = "nodejs";

const ReactSchema = z.object({
  kind: z.enum(["like", "love", "fire", "wow"])
});

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;

  const parsed = ReactSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { id } = await context.params;
  const reaction = await reactToPost(auth.session!.id, id, parsed.data.kind);
  if (!reaction) return NextResponse.json({ error: "Post not found or not visible." }, { status: 404 });
  return NextResponse.json({ reaction });
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const ok = await removeReaction(auth.session!.id, id);
  if (!ok) return NextResponse.json({ error: "Post not found or not visible." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
