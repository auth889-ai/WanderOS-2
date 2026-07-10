import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/session";
import { publishPost } from "@/lib/services/post.service";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;

  const { id } = await context.params;
  try {
    const post = await publishPost(auth.session!.id, id);
    if (!post) return NextResponse.json({ error: "Post not found or not accessible." }, { status: 404 });
    return NextResponse.json({ post });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to publish post." },
      { status: 400 }
    );
  }
}
