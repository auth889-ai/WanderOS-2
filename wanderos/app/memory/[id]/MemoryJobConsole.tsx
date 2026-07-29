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
  original: { label: "Real photo", cls: "bg-aurora/15 text-forest" },
  parallax: { label: "Real photo + motion", cls: "bg-aurora/15 text-forest" },
  gen_image: { label: "AI image", cls: "bg-sand text-slateInk" },
  hero_video: { label: "AI motion on real photo", cls: "bg-sand text-slateInk" },
  synthetic_scene: { label: "AI-recreated scene", cls: "bg-[#F6E9DC] text-[#8A5A2B]" }
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
    <div className="-m-6 min-h-screen bg-canvas p-6 md:-m-8 md:p-8">
      <div className="mx-auto max-w-3xl space-y-6 py-8">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-forest">
          <Bot className="h-6 w-6" />
          <span className="text-sm font-semibold uppercase tracking-wide">Travel Autopilot</span>
          <span className="ml-auto rounded-full border border-line bg-sand px-3 py-1 text-xs font-medium text-slateInk">
            {status.replaceAll("_", " ")} · {job?.progress_pct ?? 0}%
          </span>
        </div>
        <h1 className="font-display text-[2rem] leading-tight text-ink">
          {storyboard?.title ?? job?.request_text ?? "Loading your trip…"}
        </h1>
        {job?.error && (
          <p className="flex items-center gap-2 rounded-lg bg-[#FBF3E9] p-3 text-sm text-[#8A5A2B]">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {job.error}
          </p>
        )}
      </header>

      {/* Live agent feed */}
      <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slateInk">
          <Sparkles className="h-4 w-4 text-forest" /> Live agent activity
        </h2>
        <ul className="max-h-48 space-y-1 overflow-y-auto font-mono text-xs text-slateInk">
          {events.length === 0 && <li className="text-slateInk">waiting for events…</li>}
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
          <h2 className="flex items-center gap-2 font-display text-[1.35rem] text-ink">
            <ShieldCheck className="h-5 w-5 text-forest" /> What your evidence proves
            {job?.evidence?.sources_used?.length ? (
              <span className="text-xs font-normal text-slateInk">
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
                      ? "border-forest/25 bg-forest/[0.05]"
                      : confirmed
                        ? "border-forest/25 bg-forest/[0.05]"
                        : "border-[#E4C9A8] bg-[#FBF3E9]"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {verified ? (
                      <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-forest" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#8A5A2B]" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slateInk">{c.text}</p>
                      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-slateInk">
                        {c.status.replaceAll("_", " ")} · confidence {Math.round((c.confidence ?? 0) * 100)}%
                        {c.evidence?.length ? ` · from ${c.evidence.join(", ")}` : ""}
                      </p>

                      {c.question && (c.status === "INFERRED" || c.status === "CONTRADICTED") && (
                        <div className="mt-2">
                          <p className="mb-1.5 text-sm text-slateInk">{c.question}</p>
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
                                    ? "bg-forest text-ink"
                                    : "bg-card text-[#8A5A2B] ring-1 ring-[#E4C9A8] hover:bg-[#F6E9DC]"
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
                className="inline-flex items-center gap-2 rounded-xl bg-forest px-5 py-3 font-semibold text-ink transition hover:bg-forestDeep disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Confirm — then plan the story
              </button>
              {!allClaimsAnswered && (
                <span className="text-xs text-[#8A5A2B]">
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
          <h2 className="flex items-center gap-2 font-display text-[1.35rem] text-ink">
            <Clapperboard className="h-5 w-5 text-forest" /> Storyboard
            {status === "awaiting_storyboard_approval" && (
              <span className="rounded-full bg-[#F6E9DC] px-3 py-0.5 text-xs font-medium text-[#8A5A2B]">
                needs your approval
              </span>
            )}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {storyboard.scenes.map((s) => {
              const badge = SOURCE_LABEL[s.source] ?? SOURCE_LABEL.original;
              const engineScene = engine?.scenes?.find((es) => es.idx === s.idx);
              return (
                <div key={s.idx} className="rounded-2xl border border-line bg-card p-4 transition hover:border-forest/25">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-xs font-bold text-slateInk">#{s.idx + 1}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>
                      {badge.label}
                    </span>
                    <span className="ml-auto text-[11px] text-slateInk">{s.durationSec}s</span>
                  </div>
                  <p className="text-sm font-medium text-slateInk">“{s.narrationLine}”</p>
                  <p className="mt-1 truncate text-xs text-slateInk">{s.genPrompt ?? s.motionPrompt}</p>
                  {engineScene && (
                    <p className="mt-2 text-[11px] text-slateInk">
                      {engineScene.skipped
                        ? "skipped (no consent)"
                        : `${engineScene.attempts.length || "no"} critic-judged attempt${engineScene.attempts.length === 1 ? "" : "s"}`}
                    </p>
                  )}
                  {s.needsConsent && status === "awaiting_storyboard_approval" && (
                    <div className="mt-3 rounded-lg bg-[#FBF3E9] p-2 text-xs">
                      <p className="mb-1 font-medium text-[#8A5A2B]">
                        This moment has no photo evidence. Recreate it with AI (clearly labeled)?
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setConsents((c) => ({ ...c, [s.idx]: true }))}
                          className={`rounded-md px-2 py-1 font-medium ${consents[s.idx] === true ? "bg-forest text-ink" : "bg-card text-[#8A5A2B] ring-1 ring-[#E4C9A8]"}`}
                        >
                          Recreate &amp; label
                        </button>
                        <button
                          onClick={() => setConsents((c) => ({ ...c, [s.idx]: false }))}
                          className={`rounded-md px-2 py-1 font-medium ${consents[s.idx] === false ? "bg-ink text-ink" : "bg-card text-slateInk ring-1 ring-line"}`}
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
                className="inline-flex items-center gap-2 rounded-xl bg-forest px-5 py-3 font-semibold text-ink transition hover:bg-forestDeep disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Approve — start generating
              </button>
              <button
                onClick={() => decideStoryboard("rejected")}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-xl border border-line px-4 py-3 text-slateInk hover:bg-sand"
              >
                <XCircle className="h-4 w-4" /> Reject
              </button>
              {!allConsentsAnswered && (
                <span className="text-xs text-[#8A5A2B]">Answer the consent question on each amber scene first.</span>
              )}
            </div>
          )}
        </section>
      )}

      {/* Final approval + provenance */}
      {(status === "awaiting_final_approval" || status === "delivered") && (
        <section className="space-y-4 rounded-2xl border border-forest/20 bg-forest/[0.04] p-6">
          <h2 className="flex items-center gap-2 font-display text-[1.35rem] text-ink">
            <Film className="h-5 w-5 text-forest" /> Your sealed film
          </h2>
          {engine?.stored && (
            <p className="flex items-center gap-2 text-sm text-slateInk">
              <Lock className="h-4 w-4 text-forest" />
              Provenance record: <code className="rounded bg-sand px-1.5 py-0.5 text-xs text-forest">{engine.stored}</code>
            </p>
          )}
          {engine?.verification && (
            <div className="space-y-1">
              {Object.entries(engine.verification.checks).map(([name, c]) => (
                <p key={name} className="flex items-center gap-2 text-sm">
                  {c.pass ? (
                    <BadgeCheck className="h-4 w-4 text-forest" />
                  ) : (
                    <XCircle className="h-4 w-4 text-[#B4462F]" />
                  )}
                  <span className="font-medium text-slateInk">{name.replaceAll("_", " ")}:</span>
                  <span className="text-slateInk">{c.detail}</span>
                </p>
              ))}
            </div>
          )}
          {status === "awaiting_final_approval" && (
            <div className="flex gap-3">
              <button
                onClick={() => decideFinal("approved")}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-xl bg-forest px-5 py-3 font-semibold text-ink hover:bg-forestDeep disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Approve &amp; deliver
              </button>
              <button
                onClick={() => decideFinal("rejected")}
                disabled={busy}
                className="rounded-xl border border-line px-4 py-3 text-slateInk hover:bg-sand"
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
                className="inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-3 font-semibold text-ink hover:bg-forestDeep disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Verify this film now
              </button>
              {verify && (
                <div
                  className={`rounded-lg p-3 text-sm ${verify.verified ? "bg-aurora/15 text-forest" : "bg-[#FBF3E9] text-[#B4462F]"}`}
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

        {error && <p className="text-sm text-[#B4462F]">{error}</p>}
      </div>
    </div>
  );
}
