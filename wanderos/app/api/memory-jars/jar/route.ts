import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { queryAurora } from "@/lib/db/pool";
import { generateJar } from "@/lib/agents/crews/memory-jar/media/falImage";
import { directJar } from "@/lib/agents/crews/memory-jar/agents/jar-director/agent";
import { retrieve, toGroundedContext } from "@/lib/agents/tools/pgvector-retriever.tool";

export const runtime = "nodejs";
export const maxDuration = 60;

const DAILY_LIMIT = 2;
const Schema = z.object({ hint: z.string().max(300).optional() });

async function ensureUsageTable() {
  await queryAurora(`create table if not exists jar_ai_usage (user_id uuid, day date, used int default 0, primary key (user_id, day))`, []).catch(() => {});
}
async function usedToday(uid: string): Promise<number> {
  const [r] = await queryAurora<{ used: number }>(`select used from jar_ai_usage where user_id=$1 and day=current_date`, [uid]).catch(() => []);
  return r?.used ?? 0;
}

/** GET → remaining premium AI-jar quota for today. */
export async function GET() {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  await ensureUsageTable();
  const used = await usedToday(auth.session!.id);
  return NextResponse.json({ remaining: Math.max(0, DAILY_LIMIT - used), limit: DAILY_LIMIT });
}

/**
 * POST → PREMIUM AI jar (way 2): semantic — reads the traveler's OWN memories (pgvector RAG) →
 * jar-director crafts a personalized scene → world-class #33-shaped jar. Rate-limited to DAILY_LIMIT/day (GPT-free-tier style).
 */
export async function POST(request: NextRequest) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  const uid = auth.session!.id;
  const parsed = Schema.safeParse(await request.json().catch(() => ({})));
  const hint = parsed.success ? parsed.data.hint : undefined;

  await ensureUsageTable();
  const used = await usedToday(uid);
  if (used >= DAILY_LIMIT) {
    return NextResponse.json({ error: `You've used today's ${DAILY_LIMIT} free AI jars. Pick a template, or come back tomorrow.`, remaining: 0 }, { status: 429 });
  }

  // semantic: retrieve the traveler's own memories (embeddings), plus recent post captions as backup context
  const hits = await retrieve({ query: hint || "my most meaningful travel memories and adventures", ownerTypes: ["post", "trip", "memory", "research"], userId: uid, limit: 6 }).catch(() => []);
  let memoryContext = toGroundedContext(hits).context;
  if (!hits.length) {
    const posts = await queryAurora<{ caption: string | null; location: string | null }>(`select caption, location from travel_posts where author_id=$1 order by created_at desc limit 8`, [uid]).catch(() => []);
    memoryContext = posts.map((p) => [p.location, p.caption].filter(Boolean).join(" — ")).filter(Boolean).join("\n");
  }

  const plan = await directJar({ memoryContext, hint }).catch(() => null);
  const scene = plan?.scene || hint || "a dreamy collage of the traveler's favourite destinations at golden hour";
  const url = await generateJar(scene);
  if (!url) return NextResponse.json({ error: "Couldn’t generate — try again.", remaining: DAILY_LIMIT - used }, { status: 500 });

  await queryAurora(`insert into jar_ai_usage (user_id, day, used) values ($1, current_date, 1) on conflict (user_id, day) do update set used = jar_ai_usage.used + 1`, [uid]).catch(() => {});
  return NextResponse.json({ url, title: plan?.title ?? "Your Memory Jar", emotion: plan?.emotion, remaining: Math.max(0, DAILY_LIMIT - used - 1) });
}
