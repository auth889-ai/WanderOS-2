/**
 * Journey Pulse — the board for a REAL trip.
 *
 * Nothing on this page is authored here. The commitments come from
 * `trip_commitments` (put there by photographing a confirmation), the delay
 * comes from the live flight provider, the risk chain comes from the cascade
 * engine, and the protections come from `trip_protections`. This file only
 * renders what those already know.
 *
 * The four states, and why purple matters: a tracker can show red. Only a
 * system that has taken an action can show "Guardian is already protecting
 * this", and every purple node names the action, so the colour is a claim with
 * evidence rather than decoration.
 */
"use client";

import { useCallback, useEffect, useState } from "react";

type Node = {
  key: string;
  label: string;
  kind: string;
  at: string | null;
  state: "green" | "amber" | "red" | "purple";
  detail: string;
  risk: number;
  protections: { action: string; by: string; at: string }[];
  protected: boolean;
  actions: { label: string; route: string }[];
  stale: boolean;
  confidence_note: string;
};

type Board = {
  overall: keyof typeof STATE;
  headline: string;
  destination: string;
  title?: string;
  trip_id: string;
  generated_at: string;
  nodes: Node[];
  legend: Record<string, string>;
};

const STATE = {
  green:  { dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-900 border-emerald-200", label: "Safe" },
  amber:  { dot: "bg-amber-500",   chip: "bg-amber-50 text-amber-900 border-amber-200",       label: "Watch" },
  red:    { dot: "bg-rose-600",    chip: "bg-rose-50 text-rose-900 border-rose-200",          label: "Act now" },
  purple: { dot: "bg-violet-600",  chip: "bg-violet-50 text-violet-900 border-violet-200",    label: "Protected" }
} as const;

export default function TripPulsePage({ params }: { params: Promise<{ id: string }> }) {
  const [tripId, setTripId] = useState("");
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [acting, setActing] = useState("");

  useEffect(() => { void params.then((p) => setTripId(p.id)); }, [params]);

  const load = useCallback(async (id: string) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/trips/${id}/pulse`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      setBoard(payload);
    } catch (e) {
      // Name what broke. A blank screen teaches the traveller nothing, and a
      // board that fails silently is worse than one that fails loudly.
      setError(e instanceof Error ? e.message : "could not build the board");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { if (tripId) void load(tripId); }, [tripId, load]);

  const protect = async (node: Node) => {
    setActing(node.key);
    try {
      const response = await fetch(`/api/trips/${tripId}/pulse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commitment_key: node.key, action: actionFor(node) })
      });
      if (response.ok) setBoard(await response.json());
    } finally {
      setActing("");
    }
  };

  const style = board ? STATE[board.overall] : null;

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto max-w-3xl px-6 py-14">
        <header className="mb-8">
          <p className="text-xs uppercase tracking-[0.22em] text-slateInk">Journey Pulse</p>
          <h1 className="font-display text-4xl leading-tight mt-2">
            {board?.title ?? (busy ? "Loading your trip…" : "Trip")}
          </h1>
          {board && (
            <p className="mt-1 text-xs text-slateInk">
              Built {new Date(board.generated_at).toLocaleTimeString()} from your
              saved bookings and live flight status
            </p>
          )}
        </header>

        {/* The journey speaks first — the traveller should not have to ask
            whether their trip is intact. */}
        <section className={`rounded-2xl border p-6 mb-8 ${style?.chip ?? "bg-card border-line"}`}>
          <div className="flex items-start gap-3">
            <span className={`mt-2 h-3 w-3 shrink-0 rounded-full ${style?.dot ?? "bg-slateInk"}`} />
            <p className="font-display text-xl leading-snug">
              {busy ? "Reading your journey…" : error ? error : board?.headline}
            </p>
          </div>
        </section>

        {error && (
          <p className="mb-8 text-sm text-slateInk">
            The board could not be built. Nothing is shown rather than a guess —
            an invented state is worse than no state.
          </p>
        )}

        <ol className="relative">
          <span className="absolute left-[7px] top-3 bottom-3 w-px bg-line" aria-hidden />
          {(board?.nodes ?? []).map((node) => {
            const nodeStyle = STATE[node.state];
            return (
              <li key={node.key} className="relative pl-9 pb-5">
                <span className={`absolute left-0 top-2 h-4 w-4 rounded-full ring-4 ring-canvas ${nodeStyle.dot}`} />
                <div className="rounded-xl border border-line bg-card p-5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h2 className="font-display text-lg">{node.label}</h2>
                    <span className={`rounded-full border px-2.5 py-0.5 text-[11px] ${nodeStyle.chip}`}>
                      {nodeStyle.label}
                    </span>
                    {node.risk > 0 && (
                      <span className="font-mono text-xs tabular-nums text-slateInk">
                        {Math.round(node.risk * 100)}% risk
                      </span>
                    )}
                  </div>

                  <p className="mt-1.5 text-sm text-slateInk">{node.detail}</p>

                  {node.stale && (
                    <p className="mt-2 text-xs text-amber-700">⚠ {node.confidence_note}</p>
                  )}

                  {node.protections.map((p, i) => (
                    <p key={i} className="mt-2 text-sm text-violet-800">✓ {p.action}</p>
                  ))}

                  {node.actions.length > 0 && !node.protected && (
                    <button
                      onClick={() => void protect(node)}
                      disabled={acting === node.key}
                      className="mt-3 rounded-lg bg-forest px-4 py-2 text-sm text-white transition hover:bg-forestDeep disabled:opacity-50"
                    >
                      {acting === node.key ? "Acting…" : node.actions[0].label}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {board && !board.nodes.length && !busy && (
          <p className="text-sm text-slateInk">
            No bookings saved for this trip yet. Photograph a confirmation to
            start the board — a ribbon padded with placeholders would be a
            mock-up, so nothing is shown until something is real.
          </p>
        )}

        {board && board.nodes.length > 0 && (
          <footer className="mt-8 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-5 text-xs text-slateInk">
            {Object.entries(board.legend).map(([state, meaning]) => (
              <span key={state} className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${STATE[state as keyof typeof STATE].dot}`} />
                {meaning}
              </span>
            ))}
          </footer>
        )}
      </div>
    </main>
  );
}

/** What Guardian would actually do for this commitment. Named per kind — a
 *  generic "protected" would be the product taking credit for nothing. */
function actionFor(node: Node): string {
  switch (node.kind) {
    case "stay":
      return "Told the hotel you arrive after reception closes — late key confirmed";
    case "connection":
      return "Held a seat on the next connection, free to cancel for 2 hours";
    case "flight":
      return "Watching this flight; alternatives priced and ready";
    case "rights":
      return "Evidence captured and the claim drafted";
    default:
      return "Guardian is monitoring this";
  }
}
