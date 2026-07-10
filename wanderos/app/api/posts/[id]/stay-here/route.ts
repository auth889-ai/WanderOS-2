import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/session";
import { recordStayHereClick } from "@/lib/services/post.service";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const attribution = await recordStayHereClick(auth.session!.id, id);
  if (!attribution) return NextResponse.json({ error: "Post is not bookable." }, { status: 404 });
  return NextResponse.json({ attribution });
}
