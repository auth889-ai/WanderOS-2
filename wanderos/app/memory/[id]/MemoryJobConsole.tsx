"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Bot,
  CheckCircle2,
  Clapperboard,
  Film,
  Loader2,
  Lock,
  ShieldCheck,
  Sparkles,
  XCircle
} from "lucide-react";

/**
 * The Autopilot job console — the judge-facing heart of the product.
 * One page tells the whole story: live agent progress, the storyboard checkpoint
 * with per-scene consent toggles, the generation/critic feed from the render
 * engine, the final approval gate, and the tamper-evidence verification panel.
 */

type Scene = {
  idx: number;
  source: string;
  assetKey: string | null;
  genPrompt: string | null;
  motionPrompt: string;
  narrationLine: string;
  durationSec: number;
  needsConsent: boolean;
};

type Storyboard = {
  title: string;
  arc: string;
  narrationFull: string;
  scenes: Scene[];
};

type Claim = {
  id: string;
  text: string;
  status: string;
  confidence: number;
  evidence: string[];
  question: string;
};

type JobDetail = {
  job: {
    id: string;
    status: string;
    request_text: string;
    inferred: Record<string, unknown>;
    storyboard: Storyboard | null;
    error: string | null;
    progress_pct: number;
    current_stage: string | null;
    claims: Claim[] | null;
    evidence: { sources_used?: string[] } | null;
  };
  engine: {
    status?: string;
    stored?: string;
    delivery_key?: string;
    scenes?: { idx: number; attempts: unknown[]; synthetic: boolean; skipped: boolean }[];
    verification?: { verified: boolean; checks: Record<string, { pass: boolean; detail: string }> };
  } | null;
};

const SOURCE_LABEL: Record<string, { label: string; cls: string }> = {
  original: { label: "Real photo", cls: "bg-aurora/15 text-[#B9DCA8]" },
  parallax: { label: "Real photo + motion", cls: "bg-aurora/15 text-[#B9DCA8]" },
  gen_image: { label: "AI image", cls: "bg-white/12 text-white/75" },
  hero_video: { label: "AI motion on real photo", cls: "bg-white/12 text-white/75" },
  synthetic_scene: { label: "AI-recreated scene", cls: "bg-[#E8B87A]/20 text-[#F0C9A0]" }
};

export function MemoryJobConsole({ jobId }: { jobId: string }) {
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [events, setEvents] = useState<Record<string, unknown>[]>([]);
  const [consents, setConsents] = useState<Record<number, boolean>>({});
  const [claimAnswers, setClaimAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verify, setVerify] = useState<JobDetail["engine"] extends infer _ ? { verified: boolean; checks: Record<string, { pass: boolean; detail: string }> } | null : never>(null);
  const esRef = useRef<EventSource | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/memory/${jobId}`, { cache: "no-store" });
    if (res.ok) setDetail(await res.json());
  }, [jobId]);

  // Live progress: SSE while the agent works, re-opened after each approval resume.
  useEffect(() => {
    refresh();
    const open = () => {
      esRef.current?.close();
      const es = new EventSource(`/api/memory/${jobId}/stream`);
      es.onmessage = (m) => {
        try {
          const data = JSON.parse(m.data);
          if (Array.isArray(data.events)) setEvents(data.events as Record<string, unknown>[]);
          refresh();
        } catch {
          /* keep stream alive */
        }
      };
      es.onerror = () => es.close();
      esRef.current = es;
    };
    open();
    const poll = setInterval(refresh, 5000);
    return () => {
      esRef.current?.close();
      clearInterval(poll);
    };
  }, [jobId, refresh]);

  const job = detail?.job;
  const engine = detail?.engine;
  const storyboard = job?.storyboard ?? null;
  const status = job?.status ?? "loading";

  async function decideStoryboard(decision: "approved" | "rejected") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/memory/${jobId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, consents })
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "approval failed");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "approval failed");
    } finally {
      setBusy(false);
    }
  }

  async function decideFinal(decision: "approved" | "rejected") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/memory/${jobId}/approve-final`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision })
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "approval failed");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "approval failed");
    } finally {
      setBusy(false);
    }
  }

  async function runVerify() {
    setBusy(true);
    try {
      const res = await fetch(`/api/memory/${jobId}/verify`, { cache: "no-store" });
      if (res.ok) setVerify(await res.json());
    } finally {
      setBusy(false);
    }
  }

  const consentScenes = storyboard?.scenes.filter((s) => s.needsConsent) ?? [];
  const allConsentsAnswered = consentScenes.every((s) => s.idx in consents);

  const claims = job?.claims ?? [];
  const pendingClaims = claims.filter(
    (c) => (c.status === "INFERRED" || c.status === "CONTRADICTED") && c.question
  );
  const allClaimsAnswered = pendingClaims.every((c) => c.id in claimAnswers);

  async function submitConsent() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/memory/${jobId}/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions: claimAnswers })
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "consent failed");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "consent failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-8">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-[#B9DCA8]">
          <Bot className="h-6 w-6" />
          <span className="text-sm font-semibold uppercase tracking-wide">Travel Autopilot</span>
          <span className="ml-auto rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-white/70">
            {status.replaceAll("_", " ")} · {job?.progress_pct ?? 0}%
          </span>
        </div>
        <a
          href={`/memory/${jobId}/passport`}
          className="float-right rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/75 transition hover:bg-white/10"
        >
          Experience Passport →
        </a>
        <h1 className="font-display text-[2rem] leading-tight text-white">
          {storyboard?.title ?? job?.request_text ?? "Loading your trip…"}
        </h1>
        {job?.error && (
          <p className="flex items-center gap-2 rounded-lg bg-[#E8B87A]/15 p-3 text-sm text-[#F0C9A0]">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {job.error}
          </p>
        )}
      </header>

      {/* Live agent feed */}
      <section className="rounded-2xl border border-white/12 bg-white/[0.06] p-5 backdrop-blur-xl">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white/60">
          <Sparkles className="h-4 w-4 text-[#B9DCA8]" /> Live agent activity
        </h2>
        <ul className="max-h-48 space-y-1 overflow-y-auto font-mono text-xs text-white/60">
          {events.length === 0 && <li className="text-white/60">waiting for events…</li>}
          {events.slice(-14).map((e, i) => (
            <li key={i} className="truncate">
              {String((e as { event?: string }).event ?? JSON.stringify(e)).slice(0, 120)}
            </li>
          ))}
        </ul>
      </section>

      {/* Evidence + the truth boundary — the checkpoint no other travel app has */}
      {claims.length > 0 && (
        <section className="space-y-4">
          <h2 className="flex items-center gap-2 font-display text-[1.35rem] text-white">
            <ShieldCheck className="h-5 w-5 text-[#B9DCA8]" /> What your evidence proves
            {job?.evidence?.sources_used?.length ? (
              <span className="text-xs font-normal text-white/60">
                read from {job.evidence.sources_used.join(", ")}
              </span>
            ) : null}
          </h2>

          <div className="space-y-2">
            {claims.map((c) => {
              const verified = c.status === "VERIFIED";
              const confirmed = c.status === "USER_CONFIRMED";
              return (
                <div
                  key={c.id}
                  className={`rounded-lg border p-3 ${
                    verified
                      ? "border-[#8FBF7F]/35 bg-[#8FBF7F]/[0.10]"
                      : confirmed
                        ? "border-[#8FBF7F]/35 bg-[#8FBF7F]/[0.10]"
                        : "border-[#E8B87A]/45 bg-[#E8B87A]/[0.12]"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {verified ? (
                      <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#B9DCA8]" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#F0C9A0]" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white/60">{c.text}</p>
                      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-white/60">
                        {c.status.replaceAll("_", " ")} · confidence {Math.round((c.confidence ?? 0) * 100)}%
                        {c.evidence?.length ? ` · from ${c.evidence.join(", ")}` : ""}
                      </p>

                      {c.question && (c.status === "INFERRED" || c.status === "CONTRADICTED") && (
                        <div className="mt-2">
                          <p className="mb-1.5 text-sm text-white/60">{c.question}</p>
                          <div className="flex flex-wrap gap-2">
                            {[
                              ["confirmed", "Yes — recreate it, labeled"],
                              ["denied", "No — leave it out"],
                              ["unsure", "Not sure"]
                            ].map(([value, label]) => (
                              <button
                                key={value}
                                onClick={() => setClaimAnswers((a) => ({ ...a, [c.id]: value }))}
                                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                                  claimAnswers[c.id] === value
                                    ? "bg-forest text-white"
                                    : "bg-white/10 text-[#F0C9A0] ring-1 ring-[#E8B87A]/40 hover:bg-white/20"
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {status === "awaiting_consent" && (
            <div className="flex items-center gap-3">
              <button
                onClick={submitConsent}
                disabled={busy || !allClaimsAnswered}
                className="inline-flex items-center gap-2 rounded-xl bg-forest px-5 py-3 font-semibold text-white transition hover:bg-forestDeep disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Confirm — then plan the story
              </button>
              {!allClaimsAnswered && (
                <span className="text-xs text-[#F0C9A0]">
                  Answer each question above. Nothing is recreated without your say-so.
                </span>
              )}
            </div>
          )}
        </section>
      )}

      {/* Storyboard checkpoint */}
      {storyboard && (
        <section className="space-y-4">
          <h2 className="flex items-center gap-2 font-display text-[1.35rem] text-white">
            <Clapperboard className="h-5 w-5 text-[#B9DCA8]" /> Storyboard
            {status === "awaiting_storyboard_approval" && (
              <span className="rounded-full bg-[#E8B87A]/20 px-3 py-0.5 text-xs font-medium text-[#F0C9A0]">
                needs your approval
              </span>
            )}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {storyboard.scenes.map((s) => {
              const badge = SOURCE_LABEL[s.source] ?? SOURCE_LABEL.original;
              const engineScene = engine?.scenes?.find((es) => es.idx === s.idx);
              return (
                <div key={s.idx} className="rounded-2xl border border-white/12 bg-white/[0.06] p-4 backdrop-blur-xl transition hover:border-white/25">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-xs font-bold text-white/60">#{s.idx + 1}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>
                      {badge.label}
                    </span>
                    <span className="ml-auto text-[11px] text-white/60">{s.durationSec}s</span>
                  </div>
                  <p className="text-sm font-medium text-white/60">“{s.narrationLine}”</p>
                  <p className="mt-1 truncate text-xs text-white/60">{s.genPrompt ?? s.motionPrompt}</p>
                  {engineScene && (
                    <p className="mt-2 text-[11px] text-white/60">
                      {engineScene.skipped
                        ? "skipped (no consent)"
                        : `${engineScene.attempts.length || "no"} critic-judged attempt${engineScene.attempts.length === 1 ? "" : "s"}`}
                    </p>
                  )}
                  {s.needsConsent && status === "awaiting_storyboard_approval" && (
                    <div className="mt-3 rounded-lg bg-[#E8B87A]/12 p-2 text-xs">
                      <p className="mb-1 font-medium text-[#F0C9A0]">
                        This moment has no photo evidence. Recreate it with AI (clearly labeled)?
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setConsents((c) => ({ ...c, [s.idx]: true }))}
                          className={`rounded-md px-2 py-1 font-medium ${consents[s.idx] === true ? "bg-forest text-white" : "bg-white/10 text-[#F0C9A0] ring-1 ring-[#E8B87A]/40"}`}
                        >
                          Recreate &amp; label
                        </button>
                        <button
                          onClick={() => setConsents((c) => ({ ...c, [s.idx]: false }))}
                          className={`rounded-md px-2 py-1 font-medium ${consents[s.idx] === false ? "bg-ink text-white" : "bg-white/10 text-white/70 ring-1 ring-white/20"}`}
                        >
                          Leave it out
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {status === "awaiting_storyboard_approval" && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => decideStoryboard("approved")}
                disabled={busy || !allConsentsAnswered}
                className="inline-flex items-center gap-2 rounded-xl bg-forest px-5 py-3 font-semibold text-white transition hover:bg-forestDeep disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Approve — start generating
              </button>
              <button
                onClick={() => decideStoryboard("rejected")}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-4 py-3 text-white/75 hover:bg-white/10"
              >
                <XCircle className="h-4 w-4" /> Reject
              </button>
              {!allConsentsAnswered && (
                <span className="text-xs text-[#F0C9A0]">Answer the consent question on each amber scene first.</span>
              )}
            </div>
          )}
        </section>
      )}

      {/* Final approval + provenance */}
      {(status === "awaiting_final_approval" || status === "delivered") && (
        <section className="space-y-4 rounded-2xl border border-[#8FBF7F]/30 bg-[#8FBF7F]/[0.10] p-6 backdrop-blur-xl">
          <h2 className="flex items-center gap-2 font-display text-[1.35rem] text-white">
            <Film className="h-5 w-5 text-[#B9DCA8]" /> Your sealed film
          </h2>
          {engine?.stored && (
            <p className="flex items-center gap-2 text-sm text-white/60">
              <Lock className="h-4 w-4 text-[#B9DCA8]" />
              Provenance record: <code className="rounded bg-black/35 px-1.5 py-0.5 text-xs text-[#B9DCA8]">{engine.stored}</code>
            </p>
          )}
          {engine?.verification && (
            <div className="space-y-1">
              {Object.entries(engine.verification.checks).map(([name, c]) => (
                <p key={name} className="flex items-center gap-2 text-sm">
                  {c.pass ? (
                    <BadgeCheck className="h-4 w-4 text-[#B9DCA8]" />
                  ) : (
                    <XCircle className="h-4 w-4 text-[#FFB08F]" />
                  )}
                  <span className="font-medium text-white/60">{name.replaceAll("_", " ")}:</span>
                  <span className="text-white/60">{c.detail}</span>
                </p>
              ))}
            </div>
          )}
          {status === "awaiting_final_approval" && (
            <div className="flex gap-3">
              <button
                onClick={() => decideFinal("approved")}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-xl bg-forest px-5 py-3 font-semibold text-white hover:bg-forestDeep disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Approve &amp; deliver
              </button>
              <button
                onClick={() => decideFinal("rejected")}
                disabled={busy}
                className="rounded-xl border border-white/20 px-4 py-3 text-white/75 hover:bg-white/10"
              >
                Request changes
              </button>
            </div>
          )}
          {status === "delivered" && (
            <div className="space-y-3">
              <button
                onClick={runVerify}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-3 font-semibold text-white hover:bg-forestDeep disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Verify this film now
              </button>
              {verify && (
                <div
                  className={`rounded-lg p-3 text-sm ${verify.verified ? "bg-aurora/15 text-[#B9DCA8]" : "bg-[#FBF3E9] text-[#FFB08F]"}`}
                >
                  {verify.verified
                    ? "✓ All three independent checks passed — this film is exactly what was sealed."
                    : "✗ Verification FAILED — this file does not match the sealed publish record."}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {error && <p className="text-sm text-[#FFB08F]">{error}</p>}
    </div>
  );
}
