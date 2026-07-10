import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { followUser, unfollowUser } from "@/lib/db/tables/follows";

export const runtime = "nodejs";

const FollowSchema = z.object({
  followingId: z.string().uuid()
});

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(["traveler", "host"]);
  if (auth.response) return auth.response;

  const parsed = FollowSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const follow = await followUser(auth.session!.id, parsed.data.followingId);
  if (!follow) return NextResponse.json({ error: "Cannot follow this user." }, { status: 400 });
  return NextResponse.json({ follow }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireApiRole(["traveler", "host"]);
  if (auth.response) return auth.response;

  const parsed = FollowSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  await unfollowUser(auth.session!.id, parsed.data.followingId);
  return NextResponse.json({ ok: true });
}
