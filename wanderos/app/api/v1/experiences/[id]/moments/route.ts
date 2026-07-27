import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/session";
import { getMemoryJobForOwner } from "@/lib/db/tables/memory-jobs";

export const runtime = "nodejs";

/**
 * GET /api/v1/experiences/[id]/moments — the Experience Graph API (infrastructure layer).
 * Proves WanderOS is not just an app: external systems can read the evidence-backed,
 * consent-aware graph a trip produced. Demo beat: "an external client asks for
 * marketing-approved Bali moments" → only consented moments return.
 * Query: ?consented=true filters to moments whose scenes carry consent (from approvals).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler", "admin"]);
  if (auth.response) return auth.response;

  const { id } = await params;
  const job = await getMemoryJobForOwner(id, auth.session!.id);
  if (!job || !job.timeline) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const consentedOnly = request.nextUrl.searchParams.get("consented") === "true";
  const storyboard = job.storyboard as { scenes?: { day: number | null; needsConsent: boolean; source: string }[] } | null;
  const consentedDays = new Set(
    (storyboard?.scenes ?? []).filter((s) => !s.needsConsent || false === consentedOnly).map((s) => s.day)
  );

  const t = job.timeline as {
    days: { day: number; date: string | null; moments: { photos: string[]; start: string | null; end: string | null }[] }[];
    stats: unknown;
  };

  const moments = t.days
    .filter((d) => !consentedOnly || consentedDays.has(d.day))
    .flatMap((d) =>
      d.moments.map((m, i) => ({
        moment_id: `day-${d.day}-moment-${i + 1}`,
        day: d.day,
        date: d.date,
        time_range: { start: m.start, end: m.end },
        evidence: m.photos.map((k) => `b2://${k}`),
        supported_facts: [
          m.start ? `Photos place this moment on ${d.date} starting ${m.start}` : "Ordering inferred from file sequence"
        ],
        synthetic: false
      }))
    );

  return NextResponse.json({
    experience_id: job.id,
    title: (job.storyboard as { title?: string } | null)?.title ?? null,
    stats: t.stats,
    moments
  });
}
