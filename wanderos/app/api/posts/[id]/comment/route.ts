import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { commentOnPost, listVisibleComments } from "@/lib/services/post.service";

export const runtime = "nodejs";

const CommentSchema = z.object({
  body: z.string().trim().min(1).max(1000),
  parentId: z.string().uuid().nullable().optional()
});

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler", "admin"]);
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const comments = await listVisibleComments(id);
  if (!comments) return NextResponse.json({ error: "Post not found or not visible." }, { status: 404 });
  return NextResponse.json({ comments });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;

  const parsed = CommentSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { id } = await context.params;
  try {
    const comment = await commentOnPost(auth.session!.id, id, parsed.data.body, parsed.data.parentId);
    if (!comment) return NextResponse.json({ error: "Post not found or not visible." }, { status: 404 });
    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to comment." },
      { status: 400 }
    );
  }
}
