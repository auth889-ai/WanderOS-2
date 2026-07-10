import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { runTravelIntel } from "@/lib/agents/crews/travel-intel";
import { saveTravelProfile } from "@/lib/db/tables/travel-profiles";

export const runtime = "nodejs";
export const maxDuration = 60;

const Schema = z.object({
  query: z.string().min(1).max(200),
  budget: z.string().max(40).optional(),
  interests: z.array(z.string().max(30)).max(8).optional(),
  dateFrom: z.string().max(20).optional(),
  dateTo: z.string().max(20).optional()
});

/** POST → real-data travel intelligence (holidays · festivals · places · stays · prediction). Traveler-only. */
export async function POST(request: NextRequest) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  const parsed = Schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  try {
    const intel = await runTravelIntel({ ...parsed.data, userId: auth.session!.id });
    // remember the user's input so it's pre-filled + editable next time
    await saveTravelProfile(auth.session!.id, { budget: parsed.data.budget ?? null, interests: parsed.data.interests, lastQuery: parsed.data.query }).catch(() => {});
    return NextResponse.json({ intel });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Travel intelligence failed." }, { status: 500 });
  }
}
