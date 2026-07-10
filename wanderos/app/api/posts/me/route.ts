import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/session";
import { listOwnPosts } from "@/lib/services/post.service";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;

  const posts = await listOwnPosts(auth.session!.id);
  return NextResponse.json({ posts });
}
