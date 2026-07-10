import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { queryAurora } from "@/lib/db/pool";
import { analyzeReflection } from "@/lib/agents/crews/memory-jar/agents/reflection-analyst/agent";

export const runtime = "nodejs";
export const maxDuration = 60;

type Row = { caption: string | null; location: string | null; created_at: string };

/** GET → AI Predictive Reflection + a draft Message to Future Self (free; reflects across the traveler's memories). */
export async function GET() {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  const rows = await queryAurora<Row>(`select caption, location, created_at from travel_posts where author_id=$1 order by created_at desc limit 40`, [auth.session!.id]).catch(() => []);
  const memories = rows.map((r) => ({ caption: r.caption ?? undefined, place: r.location ?? undefined, year: new Date(r.created_at).getFullYear() }));
  const firstName = (auth.session!.name || "You").trim().split(/\s+/)[0];
  const reflection = await analyzeReflection({ name: firstName, memories }).catch(() => null);
  if (!reflection) return NextResponse.json({ error: "Could not reflect — add a few memories." }, { status: 500 });
  return NextResponse.json({ reflection });
}

const Schedule = z.object({ body: z.string().min(2).max(1000), deliverAt: z.string() });

/** POST → schedule a Message to Future Self for a future date. */
export async function POST(request: NextRequest) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  const parsed = Schedule.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "message + future date required" }, { status: 400 });
  const when = new Date(parsed.data.deliverAt);
  if (isNaN(when.getTime()) || when.getTime() <= Date.now()) return NextResponse.json({ error: "Pick a future date." }, { status: 400 });
  const [row] = await queryAurora<{ id: string; deliver_at: string }>(
    `insert into future_messages (owner_id, body, deliver_at) values ($1,$2,$3) returning id, deliver_at`,
    [auth.session!.id, parsed.data.body, when.toISOString()]
  );
  return NextResponse.json({ scheduled: true, id: row.id, deliverAt: row.deliver_at });
}
