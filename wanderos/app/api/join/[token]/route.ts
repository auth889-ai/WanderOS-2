import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getMemoryJob } from "@/lib/db/tables/memory-jobs";
import { addContributor, redeemInvite } from "@/lib/db/tables/memory-contributors";

export const runtime = "nodejs";

const JoinSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  // Consent is asked at join time, before a single photo is uploaded — after
  // would mean collecting first and asking later, which is the pattern this
  // whole product exists to avoid.
  consent: z.enum(["public", "private_only"]).default("private_only"),
  isMinor: z.boolean().default(false)
});

/**
 * POST /api/join/[token] — join a trip as a contributor.
 *
 * No account required. A group trip's photos are spread across phones belonging
 * to people who will never sign up, and requiring registration is exactly why
 * those photos stay stranded.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const parsed = JoinSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // Redeem first: it validates and increments atomically, so a race for the last
  // use of a capped invite cannot let two people through.
  const invite = await redeemInvite(token);
  if (!invite) return NextResponse.json({ error: "invite_invalid" }, { status: 404 });

  const job = await getMemoryJob(invite.job_id);
  if (!job) return NextResponse.json({ error: "trip_not_found" }, { status: 404 });

  const session = await getSession();
  const contributor = await addContributor({
    jobId: job.id,
    displayName: parsed.data.displayName,
    userId: session?.id ?? null,
    inviteToken: token,
    consent: parsed.data.consent,
    isMinor: parsed.data.isMinor
  });

  return NextResponse.json({
    contributor,
    job: { id: job.id, title: (job.storyboard as { title?: string } | null)?.title ?? null }
  });
}
