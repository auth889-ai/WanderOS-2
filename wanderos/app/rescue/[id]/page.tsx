/**
 * Recovery Theatre — the screen for a broken journey.
 *
 * Every number here comes from somewhere real: the cascade engine for risk and
 * expected loss, Duffel for fares and hold deadlines, openrouteservice for the
 * walking a wheelchair user actually faces, and `journey_actions` for what has
 * already been decided.
 *
 * Two rules the layout enforces rather than merely states:
 *
 * **Purple requires proof.** The protected panel renders only when the
 * persisted action is `verified` AND carries a provider reference. A colour is
 * not evidence.
 *
 * **Unknown accessibility is never shown as accessible.** ORS routes a
 * wheelchair PROFILE over map geometry; that is not a verified step-free path,
 * and the card says so where a traveller will read it.
 */
"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";

type Option = {
  archetype: string; title: string; offerId: string; carrier: string;
  amount: number; trueCost: number; currency: string;
  durationMinutes: number; segments: number; includedCheckedBags: number;
  holdable: boolean; expiresAt: string | null;
  departsAt: string; arrivesAt: string;
  walkingMetres: number | null; fatigue: number;
  accessibility: { level: string; basis: string; caveat: string };
  because: string;
  evidence: Array<{ label: string; value: string; source: string; freshness: string }>;
};

type Action = {
  id: string; state: string; provider: string; provider_mode: string;
  provider_reference: string | null; provider_order_id: string | null;
  amount: string | null; currency: string;
  rollback_deadline: string | null; failure_reason: string;
  chosen_offer_id: string | null;
};

type Rescue = {
  trip: { id: string; title: string; destination: string };
  broken: { key: string; label: string; kind: string };
  cascade: {
    headline: string; expected_loss: number; currency: string;
    at_risk: Array<{ commitment: string; risk: number; band: string; late_by_minutes: number; because: string; hard_deadline_breached: string | null }>;
    absorbed: Array<{ commitment: string; why: string }>;
  } | null;
  action: Action;
  events: Array<{ from_state: string | null; to_state: string; detail: string; created_at: string }>;
  options: Option[];
  offersSearched?: number;
  unavailable?: string;
  routeUnavailable?: string | null;
  restored?: boolean;
  providerMode: string;
  priceChanged?: { from: number; to: number; currency: string };
  duplicate?: boolean;
  message?: string;
};

const STATE_ORDER = ["detected", "simulated", "priced", "approved", "executing", "verified"];

const hhmm = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function RescuePage({ params }: { params: Promise<{ id: string }> }) {
  const [tripId, setTripId] = useState("");
  const [data, setData] = useState<Rescue | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<Option | null>(null);
  const [acting, setActing] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => { void params.then((p) => setTripId(p.id)); }, [params]);

  const load = useCallback(async (id: string) => {
    setBusy(true); setError("");
    try {
      const r = await fetch(`/api/trips/${id}/rescue?commitment=flight&delay=95`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setData(j);
      if (j.action?.chosen_offer_id) setSelected(j.action.chosen_offer_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not load the rescue");
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { if (tripId) void load(tripId); }, [tripId, load]);

  const decide = async (decision: "approve" | "reject") => {
    if (!tripId || (decision === "approve" && !selected)) return;
    setActing(true); setNotice("");
    try {
      const r = await fetch(`/api/trips/${tripId}/rescue`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commitmentKey: "flight", decision, offerId: selected })
      });
      const j = await r.json();
      if (j.priceChanged) {
        setNotice(`The price moved from ${j.priceChanged.currency} ${j.priceChanged.from} to ${j.priceChanged.to} while you were deciding. Approve again to accept the new price.`);
      } else if (j.duplicate) {
        setNotice(j.message);
      }
      setData((d) => (d ? { ...d, action: j.action ?? d.action, events: j.events ?? d.events } : d));
    } finally { setActing(false); }
  };

  const action = data?.action;
  const isProtected = action?.state === "verified" && Boolean(action.provider_reference);
  const stateIndex = STATE_ORDER.indexOf(action?.state ?? "detected");

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto max-w-5xl px-6 py-10">

        {/* 1 — Broken Journey header */}
        <AnimatePresence mode="wait">
          <motion.header
            key={isProtected ? "safe" : "broken"}
            initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className={`rounded-2xl border p-7 mb-8 ${
              isProtected ? "border-violet-200 bg-violet-50" : "border-rose-200 bg-rose-50"
            }`}
          >
            <p className="text-[11px] uppercase tracking-[0.24em] text-slateInk">
              {isProtected ? "Guardian is protecting this" : "Your journey just broke"}
            </p>
            <h1 className="font-display text-4xl leading-tight mt-2">
              {busy ? "Reading your journey…"
                : error ? "This rescue could not be loaded"
                : isProtected ? "You are covered."
                : data?.cascade?.headline ?? data?.broken?.label ?? "Disruption detected"}
            </h1>
            {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
            {!error && data?.cascade && !isProtected && (
              <p className="mt-3 text-slateInk">
                {data.cascade.expected_loss > 0
                  ? `About ${data.cascade.currency}${data.cascade.expected_loss} of non-refundable booking is at risk.`
                  : "Nothing non-refundable is exposed yet."}
              </p>
            )}
            {data?.providerMode === "sandbox" && (
              <span className="mt-4 inline-block rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-[11px] text-amber-900">
                Duffel sandbox — test inventory, no real money moves
              </span>
            )}
          </motion.header>
        </AnimatePresence>

        {/* 2 — Cascade timeline */}
        {data?.cascade && !isProtected && (
          <section className="mb-9">
            <h2 className="text-[11px] uppercase tracking-[0.22em] text-slateInk mb-4">What breaks next</h2>
            <ol className="relative">
              <span className="absolute left-[7px] top-2 bottom-2 w-px bg-line" aria-hidden />
              {data.cascade.at_risk.map((r, i) => (
                <motion.li key={`${r.commitment}-${i}`} className="relative pl-9 pb-4"
                  initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.09 }}>
                  <span className={`absolute left-0 top-1.5 h-4 w-4 rounded-full ring-4 ring-canvas ${
                    r.band === "red" ? "bg-rose-600" : r.band === "amber" ? "bg-amber-400" : "bg-emerald-500"}`} />
                  <div className="rounded-xl border border-line bg-card p-4">
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <span className="font-display text-lg">{r.commitment}</span>
                      <span className="font-mono text-xs text-slateInk tabular-nums">{Math.round(r.risk * 100)}% risk</span>
                      {r.late_by_minutes > 0 && (
                        <span className="text-xs text-slateInk">{r.late_by_minutes} min late</span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-ink/80">{r.because}</p>
                    {r.hard_deadline_breached && (
                      <p className="mt-1.5 text-sm text-rose-700">⚠ {r.hard_deadline_breached}</p>
                    )}
                  </div>
                </motion.li>
              ))}
              {data.cascade.absorbed.map((a, i) => (
                <li key={`abs-${i}`} className="relative pl-9 pb-4">
                  <span className="absolute left-0 top-1.5 h-4 w-4 rounded-full ring-4 ring-canvas bg-emerald-500" />
                  <p className="text-sm text-slateInk">{a.commitment} — {a.why}</p>
                </li>
              ))}
            </ol>
          </section>
        )}

        {data?.unavailable && (
          <div className="mb-8 rounded-xl border border-amber-300 bg-amber-50 p-5">
            <p className="text-sm text-amber-900">No alternatives could be searched.</p>
            <p className="mt-1 text-xs text-slateInk">{data.unavailable}</p>
            <p className="mt-2 text-xs text-slateInk">
              Nothing is shown rather than a guess — an invented option is worse than none.
            </p>
          </div>
        )}

        {/* 3+4 — the three futures */}
        {!isProtected && (data?.options?.length ?? 0) > 0 && (
          <section className="mb-9">
            <h2 className="text-[11px] uppercase tracking-[0.22em] text-slateInk mb-4">
              Three ways forward{data?.offersSearched ? ` — chosen from ${data.offersSearched} real offers` : ""}
            </h2>
            <div className="grid gap-4 md:grid-cols-3">
              {data!.options.map((o, i) => (
                <motion.button key={o.offerId} type="button"
                  onClick={() => setSelected(o.offerId)}
                  initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1, duration: 0.4 }}
                  whileHover={{ y: -3 }}
                  className={`text-left rounded-2xl border p-5 transition ${
                    selected === o.offerId
                      ? "border-forest bg-forest/5 ring-1 ring-forest/30"
                      : "border-line bg-card hover:border-line"}`}>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slateInk">{o.title}</p>
                  <p className="font-display text-2xl mt-1 tabular-nums">
                    {o.currency} {o.trueCost}
                  </p>
                  {o.trueCost !== o.amount && (
                    <p className="text-[11px] text-amber-800">
                      fare {o.amount} + bag — true cost shown
                    </p>
                  )}
                  <p className="mt-2 text-sm text-slateInk">{o.carrier}</p>

                  <dl className="mt-4 space-y-1.5 text-xs">
                    <Row k="Arrives" v={clock(o.arrivesAt)} />
                    <Row k="Journey" v={hhmm(o.durationMinutes)} />
                    <Row k="Transfers" v={o.segments === 1 ? "direct" : `${o.segments - 1}`} />
                    <Row k="Walking" v={o.walkingMetres === null ? "unknown" : `${o.walkingMetres} m`} />
                    <Row k="Fatigue" v={`${o.fatigue}/100`} />
                    <Row k="Access" v={o.accessibility.level === "unknown" ? "unverified" : o.accessibility.level} warn />
                  </dl>

                  <p className="mt-3 text-[11px] text-slateInk leading-relaxed">{o.because}</p>

                  {!o.holdable && (
                    <p className="mt-2 text-[11px] text-rose-700">
                      Cannot be held — this airline requires instant payment.
                    </p>
                  )}

                  <span onClick={(e) => { e.stopPropagation(); setDrawer(o); }}
                    className="mt-3 inline-block cursor-pointer text-[11px] text-forest underline underline-offset-2">
                    Where these numbers come from
                  </span>
                </motion.button>
              ))}
            </div>
          </section>
        )}

        {/* 6 — irreversible action + rollback deadline */}
        {!isProtected && selected && (
          <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-5">
            <p className="text-sm text-amber-900 font-medium">Before you approve</p>
            <ul className="mt-2 space-y-1 text-xs text-ink/80">
              <li>• Approving places a <strong>hold</strong> with the airline. No money moves at this step.</li>
              <li>• Paying for a held order is <strong>irreversible</strong> and is not performed here.</li>
              {action?.rollback_deadline && (
                <li>• The hold lapses at <strong>{new Date(action.rollback_deadline).toLocaleString()}</strong>.</li>
              )}
              <li>• Accessibility is <strong>unverified</strong> — routing over map geometry, not a surveyed step-free path.</li>
            </ul>
          </motion.section>
        )}

        {notice && (
          <div className="mb-6 rounded-xl border border-coral/40 bg-rose-600/10 p-4 text-sm text-rose-800">{notice}</div>
        )}

        {/* 7 — approval controls */}
        {!isProtected && (data?.options?.length ?? 0) > 0 && (
          <div className="mb-10 flex flex-wrap gap-3">
            <button onClick={() => void decide("approve")}
              disabled={!selected || acting || action?.state === "verified"}
              className="rounded-lg bg-forest px-6 py-3 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-40">
              {acting ? "Contacting the airline…" : "Approve and hold this option"}
            </button>
            <button onClick={() => void decide("reject")} disabled={acting}
              className="rounded-lg border border-line px-6 py-3 text-sm text-slateInk transition hover:border-forest/40 disabled:opacity-40">
              None of these
            </button>
          </div>
        )}

        {/* 8 — execution state timeline */}
        {data && (
          <section className="mb-9">
            <h2 className="text-[11px] uppercase tracking-[0.22em] text-slateInk mb-4">Action state</h2>
            <div className="flex flex-wrap gap-2 mb-4">
              {STATE_ORDER.map((s, i) => (
                <span key={s} className={`rounded-full border px-3 py-1 text-[11px] ${
                  i < stateIndex ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                  : i === stateIndex ? "border-forest bg-forest/10 text-forest"
                  : "border-line text-slateInk/40"}`}>{s}</span>
              ))}
              {["rejected", "failed", "expired"].includes(action?.state ?? "") && (
                <span className="rounded-full border border-coral/50 bg-rose-600/10 px-3 py-1 text-[11px] text-rose-700">
                  {action!.state}
                </span>
              )}
            </div>
            <ol className="space-y-1.5">
              {data.events.map((e, i) => (
                <li key={i} className="flex gap-3 text-xs">
                  <span className="font-mono text-slateInk tabular-nums">{clock(e.created_at)}</span>
                  <span className="text-slateInk w-20">{e.from_state ?? "—"} → {e.to_state}</span>
                  <span className="text-ink/80 flex-1">{e.detail}</span>
                </li>
              ))}
            </ol>
            {action?.failure_reason && (
              <p className="mt-3 text-sm text-rose-700">{action.failure_reason}</p>
            )}
          </section>
        )}

        {/* 9 — verified purple result */}
        <AnimatePresence>
          {isProtected && (
            <motion.section initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5 }}
              className="rounded-2xl border border-violet-200 bg-violet-50 p-7">
              <p className="text-[11px] uppercase tracking-[0.22em] text-violet-700">Protected</p>
              <h2 className="font-display text-2xl mt-2">
                {action!.provider} confirmed reference {action!.provider_reference}
              </h2>
              <dl className="mt-4 grid gap-2 sm:grid-cols-2 text-sm">
                <Row k="Order" v={action!.provider_order_id ?? "—"} />
                <Row k="Amount held" v={action!.amount ? `${action!.currency} ${action!.amount}` : "—"} />
                <Row k="Pay by" v={action!.rollback_deadline ? new Date(action!.rollback_deadline).toLocaleString() : "not stated"} />
                <Row k="Mode" v={action!.provider_mode} warn={action!.provider_mode === "sandbox"} />
              </dl>
              <p className="mt-4 text-xs text-slateInk">
                No money has moved. The seat is held until the deadline above; after that it lapses.
              </p>
            </motion.section>
          )}
        </AnimatePresence>
      </div>

      {/* 5 — evidence drawer */}
      <AnimatePresence>
        {drawer && (
          <motion.aside initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 260 }}
            className="fixed right-0 top-0 h-full w-full max-w-md overflow-y-auto border-l border-line bg-card p-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-slateInk">Evidence</p>
                <h3 className="font-display text-xl mt-1">{drawer.title} — {drawer.carrier}</h3>
              </div>
              <button onClick={() => setDrawer(null)} className="text-slateInk hover:text-ink">✕</button>
            </div>

            <ul className="mt-6 space-y-4">
              {drawer.evidence.map((e, i) => (
                <li key={i} className="rounded-lg border border-line bg-canvas p-4">
                  <p className="text-sm">{e.label}: <span className="text-forest">{e.value}</span></p>
                  <p className="mt-1 text-[11px] text-slateInk">source: {e.source}</p>
                  <p className="text-[11px] text-slateInk">freshness: {e.freshness}</p>
                </li>
              ))}
            </ul>

            <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
              <p className="text-xs text-amber-900 font-medium">Accessibility — read this</p>
              <p className="mt-1.5 text-[11px] text-ink/80 leading-relaxed">{drawer.accessibility.caveat}</p>
              <p className="mt-2 text-[11px] text-slateInk">basis: {drawer.accessibility.basis}</p>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </main>
  );
}

function Row({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slateInk">{k}</dt>
      <dd className={`tabular-nums ${warn ? "text-amber-900" : "text-ink"}`}>{v}</dd>
    </div>
  );
}
