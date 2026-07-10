import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";

export const runtime = "nodejs";
const Schema = z.object({ text: z.string().min(2).max(200) });
const UN = process.env.UNSPLASH_ACCESS_KEY;

/** POST → FREE unlimited: a real Unsplash photo of the user's place/memory, to live inside the code-built jar. */
export async function POST(request: NextRequest) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  const parsed = Schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Type a place or memory." }, { status: 400 });
  if (!UN) return NextResponse.json({ error: "Unsplash not configured." }, { status: 500 });
  try {
    const r = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(parsed.data.text + " travel scenic")}&per_page=1&orientation=portrait&client_id=${UN}`);
    const j = (await r.json().catch(() => ({}))) as { results?: { urls?: { regular?: string }; alt_description?: string }[] };
    const url = j.results?.[0]?.urls?.regular;
    if (!url) return NextResponse.json({ error: "No photo found — try another place." }, { status: 404 });
    return NextResponse.json({ url, alt: j.results?.[0]?.alt_description ?? parsed.data.text });
  } catch { return NextResponse.json({ error: "Couldn’t fetch — try again." }, { status: 500 }); }
}
