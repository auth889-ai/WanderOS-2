import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/session";
import { enqueuePostCompose } from "@/lib/services/post.service";

export const runtime = "nodejs";

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const result = await enqueuePostCompose(auth.session!.id, id);
  if (!result) return NextResponse.json({ error: "Post not found or not accessible." }, { status: 404 });
  return NextResponse.json(result, { status: 202 });
}
