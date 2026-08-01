import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proxy to the media worker.
 *
 * The browser cannot reach the worker directly once this is deployed — it sits
 * on a different host, and exposing it publicly would put an unauthenticated
 * render endpoint on the internet. Proxying through Next keeps the worker URL
 * server-side and gives one place to add rate limiting later.
 */
const WORKER = process.env.MEDIA_WORKER_URL || "http://127.0.0.1:8000";

// Only endpoints the playground needs. An open proxy would expose /jobs/render,
// which spends real money on model calls.
const ALLOWED = new Set([
  "health", "rights/assess", "planning/weather", "planning/packing",
  "planning/dream", "planning/sensory", "planning/readiness", "planning/fairness",
  "planning/itinerary/validate", "planning/accessibility", "planning/true-cost", "journey/twin", "journey/export", "planning/destinations",
  "trust/verify-demo", "evidence/demo-classify"
]);

async function forward(request: NextRequest, path: string[], method: "GET" | "POST") {
  const route = path.join("/");
  if (!ALLOWED.has(route)) {
    return NextResponse.json({ error: `not exposed: ${route}` }, { status: 403 });
  }
  try {
    const res = await fetch(`${WORKER}/${route}`, {
      method,
      headers: method === "POST" ? { "content-type": "application/json" } : undefined,
      body: method === "POST" ? await request.text() : undefined,
      cache: "no-store"
    });
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: { "content-type": "application/json" }
    });
  } catch {
    // The worker being down is a state the page renders honestly.
    return NextResponse.json({ error: "media worker unreachable" }, { status: 503 });
  }
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await ctx.params).path, "GET");
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await ctx.params).path, "POST");
}
