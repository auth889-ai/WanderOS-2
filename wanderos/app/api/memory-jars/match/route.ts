import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { matchTemplate } from "@/lib/agents/crews/memory-jar/templates";

export const runtime = "nodejs";
const Schema = z.object({ text: z.string().min(2).max(200) });

/** POST → FREE unlimited: semantic-match the user's vibe to the best in-file jar template (embeddings, no generation). */
export async function POST(request: NextRequest) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  const parsed = Schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Type a few words." }, { status: 400 });
  const match = await matchTemplate(parsed.data.text).catch(() => null);
  if (!match) return NextResponse.json({ error: "Couldn’t match — try again." }, { status: 500 });
  return NextResponse.json(match);
}
