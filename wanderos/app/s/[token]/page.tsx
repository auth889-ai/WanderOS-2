import { notFound } from "next/navigation";
import { getMemoryJob } from "@/lib/db/tables/memory-jobs";
import { resolveShare } from "@/lib/db/tables/memory-shares";
import { presignDownload, isB2Configured } from "@/lib/media/b2";

export const dynamic = "force-dynamic";

type Claim = { id: string; text: string; status: string };

/**
 * Public share page — no login. This is what actually gets sent to family.
 *
 * Two things it does that a normal share page does not:
 *  - states plainly which moments were recreated and that permission was given
 *  - carries the verification result, so the recipient can see the film has not
 *    been altered since it was sealed
 */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const share = await resolveShare(token).catch(() => null);
  if (!share) notFound(); // revoked, expired, or never existed — all look the same

  const job = await getMemoryJob(share.job_id);
  if (!job || job.status !== "delivered") notFound();

  const storyboard = job.storyboard as { title?: string; narrationFull?: string } | null;
  const claims = ((job.claims as Claim[] | null) ?? []).filter(
    (c) => c.status === "VERIFIED" || c.status === "USER_CONFIRMED"
  );

  let engine: {
    pack?: { keys?: Record<string, string>; journal?: { summary?: Record<string, number> } };
    delivery_key?: string;
    verification?: { verified: boolean };
    stored?: string;
  } | null = null;
  try {
    const res = await fetch(
      `${process.env.MEDIA_WORKER_URL || "http://localhost:8000"}/jobs/${job.id}`,
      { cache: "no-store", signal: AbortSignal.timeout(6000) }
    );
    if (res.ok) engine = await res.json();
  } catch {
    engine = null;
  }

  // The public cut gets the reel; a private link gets the full film.
  const keys = engine?.pack?.keys ?? {};
  const mediaKey =
    share.audience === "public" ? keys["social-reel"] ?? engine?.delivery_key : engine?.delivery_key;
  const filmUrl = mediaKey && isB2Configured() ? await presignDownload(mediaKey).catch(() => null) : null;
  const coverUrl = keys["cover"] && isB2Configured()
    ? await presignDownload(keys["cover"]).catch(() => null)
    : null;

  const summary = engine?.pack?.journal?.summary ?? {};
  const recreated = summary.recreated_scenes ?? 0;

  return (
    <main className="min-h-screen bg-[#0d1512] text-white">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
          A memory film
        </p>
        <h1 className="font-display text-[2.4rem] leading-tight">
          {storyboard?.title ?? "A trip to remember"}
        </h1>

        <div className="mt-6 overflow-hidden rounded-2xl border border-white/12 bg-black">
          {filmUrl ? (
            <video
              src={filmUrl}
              poster={coverUrl ?? undefined}
              controls
              playsInline
              className="h-auto w-full"
            />
          ) : (
            <div className="p-12 text-center text-sm text-white/50">
              This film is still being prepared.
            </div>
          )}
        </div>

        {storyboard?.narrationFull && (
          <p className="mt-6 text-[15px] leading-relaxed text-white/70">
            {storyboard.narrationFull}
          </p>
        )}

        {/* The honesty panel — the whole reason this product exists. */}
        <section className="mt-8 rounded-2xl border border-white/12 bg-white/[0.04] p-5">
          <h2 className="font-display text-[1.15rem]">What this film is made of</h2>
          <ul className="mt-3 space-y-1.5 text-sm">
            <li className="flex gap-2">
              <span className="text-[#B9DCA8]">✓</span>
              <span className="text-white/70">
                {summary.photographed_moments ?? claims.length} moment
                {(summary.photographed_moments ?? claims.length) === 1 ? "" : "s"} from real photographs
              </span>
            </li>
            {recreated > 0 && (
              <li className="flex gap-2">
                <span className="text-[#F0C9A0]">◆</span>
                <span className="text-white/70">
                  {recreated} scene{recreated === 1 ? "" : "s"} recreated by AI —{" "}
                  <strong className="text-white/85">only after the traveller confirmed</strong> the
                  moment happened, and labelled on screen
                </span>
              </li>
            )}
            {engine?.verification && (
              <li className="flex gap-2">
                <span className={engine.verification.verified ? "text-[#B9DCA8]" : "text-[#FFB08F]"}>
                  {engine.verification.verified ? "✓" : "✗"}
                </span>
                <span className="text-white/70">
                  {engine.verification.verified
                    ? "Unchanged since it was sealed — signature and file hash both verify"
                    : "Verification failed — this file does not match the sealed record"}
                </span>
              </li>
            )}
          </ul>
          <p className="mt-4 text-xs leading-relaxed text-white/40">
            This confirms the recorded production history and that the file has not changed since
            sealing. It does not assert that every depicted moment occurred.
          </p>
        </section>

        <p className="mt-8 text-center text-xs text-white/30">Made with WanderOS Travel Autopilot</p>
      </div>
    </main>
  );
}
