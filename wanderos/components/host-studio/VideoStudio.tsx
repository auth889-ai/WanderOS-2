"use client";

import { useEffect, useRef, useState } from "react";
import { Film, Mic, Sparkles, Loader2, Download } from "lucide-react";
import { Button } from "@/components/ui/Button";

type Video = { id: string; type: string; mode: string; status: string; url: string | null; thumbnail_url: string | null; duration_sec: number | null };

const MODES = [
  { v: "walkthrough", label: "Walkthrough" },
  { v: "day_to_dusk", label: "Day to Dusk" },
  { v: "staging_reveal", label: "Staging Reveal" },
  { v: "drone", label: "Drone" },
  { v: "social_reel", label: "Social Reel" }
];
const STATUS_LABEL: Record<string, string> = {
  queued: "Queued…", planning: "AI crew planning the tour…", narrating: "Writing & voicing narration…",
  rendering: "Rendering cinematic motion…", composing: "Editing · music · captions…", publishing: "Publishing…",
  ready: "Ready", failed: "Failed", cancelled: "Cancelled"
};
const ACTIVE = ["queued", "planning", "narrating", "rendering", "composing", "publishing"];

/** Promo Video studio — pick a type (Cinematic Reel / Full Premium Tour) + mode, Generate, watch live
 *  progress, preview & download. Each Generate is a fresh async render on the worker. */
export function VideoStudio({ listingId }: { listingId: string }) {
  const [type, setType] = useState<"tour" | "reel">("tour");
  const [mode, setMode] = useState("walkthrough");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [video, setVideo] = useState<Video | null>(null);
  const [error, setError] = useState("");
  const [attached, setAttached] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  async function attach() {
    if (!video) return;
    const r = await fetch(`/api/host/listings/${listingId}/video`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoId: video.id })
    });
    if (r.ok) setAttached(true);
    else { const e = (await r.json().catch(() => ({}))) as { error?: string }; setError(e.error || "Could not attach"); }
  }

  async function refresh() {
    try {
      const r = await fetch(`/api/host/listings/${listingId}/video`);
      const { videos } = (await r.json()) as { videos: Video[] };
      const latest = videos?.[0];
      if (latest) {
        setVideo(latest);
        setStatus(latest.status);
        if (!ACTIVE.includes(latest.status)) {
          setBusy(false);
          if (poll.current) clearInterval(poll.current);
        }
      }
    } catch { /* keep polling */ }
  }
  useEffect(() => {
    refresh();
    return () => { if (poll.current) clearInterval(poll.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate() {
    setBusy(true); setError(""); setVideo(null); setStatus("queued");
    const r = await fetch(`/api/host/listings/${listingId}/video`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, mode })
    });
    if (!r.ok) {
      const e = (await r.json().catch(() => ({}))) as { error?: string };
      setError(e.error || "Could not start the render"); setBusy(false); return;
    }
    poll.current = setInterval(refresh, 3000);
  }

  const ready = video?.status === "ready" && video.url;

  return (
    <div className="glass rounded-[24px] p-6 text-white">
      <div className="flex items-center gap-2"><Film size={18} className="text-coral" /><h2 className="text-xl font-semibold">Promo video</h2></div>
      <p className="mt-1 text-sm text-white/55">AI turns your photos into a captivating tour — motion, music, captions{type === "tour" ? ", and a voiceover" : ""}.</p>

      {/* Type toggle */}
      <div className="mt-5 grid grid-cols-2 gap-3">
        {([["tour", "Full Premium Tour", "Motion + voice + music + captions"], ["reel", "Cinematic Reel", "Motion + music + captions"]] as const).map(([v, title, sub]) => (
          <button key={v} onClick={() => setType(v)} disabled={busy}
            className={`rounded-2xl border p-4 text-left transition ${type === v ? "border-coral bg-coral/15" : "border-white/12 bg-white/5 hover:bg-white/10"}`}>
            <span className="flex items-center gap-2 font-semibold">{v === "tour" ? <Mic size={15} /> : <Film size={15} />}{title}</span>
            <span className="mt-1 block text-xs text-white/55">{sub}</span>
          </button>
        ))}
      </div>

      {/* Mode */}
      <div className="mt-4 flex flex-wrap gap-2">
        {MODES.map((m) => (
          <button key={m.v} onClick={() => setMode(m.v)} disabled={busy}
            className={`rounded-full px-3 py-1.5 text-sm transition ${mode === m.v ? "bg-gradient-to-r from-coral to-mist text-night" : "border border-white/12 bg-white/5 text-white/75 hover:bg-white/10"}`}>
            {m.label}
          </button>
        ))}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <Button onClick={generate} disabled={busy} className="inline-flex items-center gap-2">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {busy ? "Generating…" : ready ? "Re-render" : "Generate video"}
        </Button>
        {busy && <span className="text-sm text-mist">{STATUS_LABEL[status] ?? status}</span>}
      </div>

      {error && <p className="mt-3 rounded-xl border border-coral/40 bg-coral/10 px-3 py-2 text-sm text-peach">{error}</p>}

      {ready && (
        <div className="mt-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <video src={video!.url!} poster={video!.thumbnail_url ?? undefined} controls className="w-full rounded-2xl border border-white/10" />
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <button onClick={attach} disabled={attached}
              className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold transition ${attached ? "bg-aurora/20 text-aurora" : "bg-gradient-to-r from-coral to-mist text-night hover:brightness-110"}`}>
              {attached ? "✓ Attached to listing" : "Attach to listing"}
            </button>
            <a href={video!.url!} download className="inline-flex items-center gap-2 text-sm text-white/70 hover:text-white"><Download size={15} /> Download MP4</a>
            {attached && <span className="text-xs text-white/55">Shows on your listing & travels into publish · marketplace</span>}
          </div>
        </div>
      )}
    </div>
  );
}
