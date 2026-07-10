import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { getFeed } from "@/lib/services/feed.service";

export const runtime = "nodejs";

const FeedQuerySchema = z.object({
  tab: z.enum(["for-you", "following", "trending", "destination", "verified"]).optional(),
  destination: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional()
});

export async function GET(request: NextRequest) {
  const auth = await requireApiRole(["traveler", "admin"]);
  if (auth.response) return auth.response;

  const parsed = FeedQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const posts = await getFeed({
    viewerId: auth.session!.id,
    tab: parsed.data.tab,
    destination: parsed.data.destination,
    limit: parsed.data.limit
  });

  return NextResponse.json({ posts });
}
