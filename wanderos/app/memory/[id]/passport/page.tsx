import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getMemoryJobForOwner, listApprovals } from "@/lib/db/tables/memory-jobs";

export const dynamic = "force-dynamic";

type Attempt = {
  attempt: number;
  model: string;
  decision: string;
  overall: number;
  critic: string;
  violations: string[];
  lineage: string;
};

type SceneRecord = { idx: number; synthetic: boolean; skipped: boolean; attempts: Attempt[] };

/**
 * The Experience Passport — the full production history of one film.
 *
 * Shows the rejected attempts as prominently as the accepted one. A provenance
 * page that only lists what shipped is marketing; this is the audit trail.
 */
export default async function PassportPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const { id } = await params;
  if (!session) redirect(`/login?next=/memory/${id}/passport`);

  const job = await getMemoryJobForOwner(id, session.id);
  if (!job) notFound();
  const approvals = await listApprovals(job.id).catch(() => []);

  let engine: {
    stored?: string;
    scenes?: SceneRecord[];
    verification?: { verified: boolean; checks: Record<string, { pass: boolean; detail: string }> };
    publish_record?: { retention?: string; sealed_sha256?: string };
  } | null = null;
  try {
    const res = await fetch(`${process.env.MEDIA_WORKER_URL || "http://localhost:8000"}/jobs/${job.id}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(6000)
    });
    if (res.ok) engine = await res.json();
  } catch {
    engine = null;
  }

  const claims = (job.claims as { id: string; text: string; status: string; evidence: string[] }[] | null) ?? [];
  const scenes = engine?.scenes ?? [];
  const totalAttempts = scenes.reduce((n, s) => n + (s.attempts?.length ?? 0), 0);
  const rejected = scenes.reduce(
    (n, s) => n + (s.attempts?.filter((a) => a.decision === "REJECT").length ?? 0),
    0
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-8">
      <header>
        <Link href={`/memory/${job.id}`} className="text-xs text-white/50 hover:text-white">
          ← back to the film
        </Link>
        <h1 className="mt-2 font-display text-[2rem] leading-tight text-white">Experience Passport</h1>
        <p className="mt-1 text-sm text-white/60">
          Every source, decision and attempt behind this film — including the ones that were rejected.
        </p>
      </header>

      {/* Verification */}
      <section className="rounded-2xl border border-white/12 bg-white/[0.06] p-5 backdrop-blur-xl">
        <h2 className="mb-3 font-display text-[1.2rem] text-white">Verification</h2>
        {engine?.verification ? (
          <div className="space-y-1.5">
            {Object.entries(engine.verification.checks).map(([name, c]) => (
              <p key={name} className="flex items-start gap-2 text-sm">
                <span className={c.pass ? "text-[#B9DCA8]" : "text-[#FFB08F]"}>{c.pass ? "✓" : "✗"}</span>
                <span className="font-medium text-white/85">{name.replaceAll("_", " ")}</span>
                <span className="text-white/55">{c.detail}</span>
              </p>
            ))}
          </div>
        ) : (
          <p className="text-sm text-white/50">No sealed film yet.</p>
        )}
        {engine?.stored && (
          <p className="mt-3 break-all text-xs text-white/50">
            record · <code className="text-[#B9DCA8]">{engine.stored}</code>
          </p>
        )}
        {engine?.publish_record?.retention && (
          <p className="mt-1 text-xs text-white/50">
            retention · <span className="text-[#B9DCA8]">{engine.publish_record.retention}</span>
          </p>
        )}
      </section>

      {/* What the evidence proved */}
      {claims.length > 0 && (
        <section className="rounded-2xl border border-white/12 bg-white/[0.06] p-5 backdrop-blur-xl">
          <h2 className="mb-3 font-display text-[1.2rem] text-white">What the evidence proved</h2>
          <ul className="space-y-1.5">
            {claims.map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-sm">
                <span
                  className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    c.status === "VERIFIED"
                      ? "bg-[#8FBF7F]/20 text-[#B9DCA8]"
                      : c.status === "USER_CONFIRMED"
                        ? "bg-[#E8B87A]/20 text-[#F0C9A0]"
                        : "bg-white/10 text-white/55"
                  }`}
                >
                  {c.status}
                </span>
                <span className="text-white/75">{c.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Generation lineage — rejects included */}
      <section className="rounded-2xl border border-white/12 bg-white/[0.06] p-5 backdrop-blur-xl">
        <div className="mb-3 flex items-baseline gap-3">
          <h2 className="font-display text-[1.2rem] text-white">Generation lineage</h2>
          <span className="text-xs text-white/50">
            {totalAttempts} attempt{totalAttempts === 1 ? "" : "s"} · {rejected} rejected
          </span>
        </div>
        {scenes.length === 0 ? (
          <p className="text-sm text-white/50">Nothing generated yet.</p>
        ) : (
          <div className="space-y-4">
            {scenes.map((s) => (
              <div key={s.idx} className="border-l-2 border-white/12 pl-4">
                <p className="text-sm font-medium text-white">
                  Scene {s.idx + 1}
                  {s.synthetic && (
                    <span className="ml-2 rounded bg-[#E8B87A]/20 px-1.5 py-0.5 text-[10px] text-[#F0C9A0]">
                      AI-recreated
                    </span>
                  )}
                  {s.skipped && <span className="ml-2 text-xs text-white/45">skipped — no consent</span>}
                </p>
                {(s.attempts ?? []).length === 0 ? (
                  <p className="mt-1 text-xs text-white/45">real media, no generation</p>
                ) : (
                  s.attempts.map((a) => (
                    <div key={a.attempt} className="mt-2 text-xs">
                      <p className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 font-medium ${
                            a.decision === "ACCEPT"
                              ? "bg-[#8FBF7F]/20 text-[#B9DCA8]"
                              : "bg-[#FFB08F]/20 text-[#FFB08F]"
                          }`}
                        >
                          attempt {a.attempt} · {a.decision} · {a.overall}
                        </span>
                        <span className="text-white/50">{a.model}</span>
                        <span className="text-white/35">judged by {a.critic}</span>
                      </p>
                      {a.violations?.length > 0 && (
                        <ul className="mt-1 space-y-0.5 pl-3 text-white/55">
                          {a.violations.map((v, i) => (
                            <li key={i}>— {v}</li>
                          ))}
                        </ul>
                      )}
                      {a.lineage && <p className="mt-0.5 break-all text-white/30">{a.lineage}</p>}
                    </div>
                  ))
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Human decisions */}
      {approvals.length > 0 && (
        <section className="rounded-2xl border border-white/12 bg-white/[0.06] p-5 backdrop-blur-xl">
          <h2 className="mb-3 font-display text-[1.2rem] text-white">Human decisions</h2>
          <ul className="space-y-1.5 text-sm">
            {approvals.map((a: Record<string, unknown>, i: number) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70">
                  {String(a.checkpoint)}
                </span>
                <span className="text-white/75">{String(a.decision)}</span>
                <span className="text-xs text-white/40">
                  {a.created_at ? new Date(String(a.created_at)).toLocaleString() : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="px-1 text-xs leading-relaxed text-white/45">
        This passport shows the recorded production history and confirms the delivered file has not
        changed since sealing. It does not assert that every depicted moment occurred — scenes marked
        AI-recreated were generated after the traveller confirmed the moment, and are labelled on screen.
      </p>
    </div>
  );
}
