import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { deleteOwnPost, editOwnPost, getVisiblePost } from "@/lib/services/post.service";

export const runtime = "nodejs";

const PatchPostSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  caption: z.string().trim().max(2000).nullable().optional(),
  body: z.string().trim().max(10000).nullable().optional(),
  location: z.string().trim().max(160).nullable().optional(),
  destination: z.string().trim().max(120).nullable().optional(),
  mood: z.string().trim().max(80).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  visibility: z.enum(["public", "private"]).optional()
});

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const post = await getVisiblePost(auth.session!.id, id);
  if (!post) return NextResponse.json({ error: "Post not found or not accessible." }, { status: 404 });
  return NextResponse.json(post);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;

  const parsed = PatchPostSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { id } = await context.params;
  const post = await editOwnPost(auth.session!.id, id, parsed.data);
  if (!post) return NextResponse.json({ error: "Post not found or not accessible." }, { status: 404 });
  return NextResponse.json({ post });
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const post = await deleteOwnPost(auth.session!.id, id);
  if (!post) return NextResponse.json({ error: "Post not found or not accessible." }, { status: 404 });
  return NextResponse.json({ post });
}
