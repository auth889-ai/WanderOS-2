"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, X, Film, Square, Trash2, Download, Play, Clapperboard } from "lucide-react";

type Movie = { id: string; status: string; job_status?: string | null; progress?: number; stage?: string | null; film_url?: string | null; title?: string | null };

/** Make-a-Movie studio — starts a real cinematic render, streams progress, and lets the user stop / delete / save. */
export function MovieStudio({ onClose, onFilmReady }: { onClose: () => void; onFilmReady?: (url: string, movieId: string) => void }) {
  const [movie, setMovie] = useState<Movie | null>(null);
  const [starting, setStarting] = useState(false);
  const [tier, setTier] = useState<"free" | "cinematic">("free");
  const [error, setError] = useState("");
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() { if (poll.current) { clearInterval(poll.current); poll.current = null; } }
  useEffect(() => () => stopPolling(), []);

  async function start() {
    setStarting(true); setError("");
    const r = await fetch("/api/memory-jars/movie", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "past", tier }) }).then((x) => x.json()).catch(() => ({}));
    setStarting(false);
    if (!r.movieId) { setError(r.error?.formErrors?.join(" ") || "Couldn’t start — add a couple of travel posts/photos first."); return; }
    setMovie({ id: r.movieId, status: "queued", progress: 0 });
    poll.current = setInterval(async () => {
      const j = await fetch(`/api/memory-jars/movie/${r.movieId}`).then((x) => x.json()).catch(() => ({}));
      if (j.movie) {
        setMovie(j.movie);
        const st = j.movie.job_status || j.movie.status;
        if (j.movie.film_url) onFilmReady?.(j.movie.film_url, j.movie.id);
        if (j.movie.film_url || st === "ready" || st === "succeeded" || st === "failed" || st === "cancelled") stopPolling();
      }
    }, 2500);
  }

  async function stop() { if (movie) { await fetch(`/api/memory-jars/movie/${movie.id}`, { method: "PATCH" }); stopPolling(); setMovie({ ...movie, status: "cancelled" }); } }
  async function del() { if (movie) await fetch(`/api/memory-jars/movie/${movie.id}`, { method: "DELETE" }); stopPolling(); onClose(); }

  const pct = movie?.progress ?? 0;
  const ready = !!movie?.film_url;
  const failed = (movie?.job_status || movie?.status) === "failed";
  const cancelled = (movie?.job_status || movie?.status) === "cancelled";
  const rendering = !!movie && !ready && !failed && !cancelled;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-3xl border border-[#e7b86a]/30 bg-[#1c1230] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <p className="flex items-center gap-2 text-lg font-bold text-[#f3e3c0]"><Clapperboard size={18} className="text-[#e7b86a]" /> Make My Travel Movie</p>
          <button onClick={onClose} className="text-white/50 hover:text-white"><X size={18} /></button>
        </div>

        {!movie && (
          <>
            <p className="mb-4 text-sm text-white/65">A film of your journey — <b className="text-white">starring you</b>. AI directs it, narrates, and scores it. Plays right here in your jar.</p>
            {/* tier choice — controls cost */}
            <div className="mb-4 grid grid-cols-2 gap-2">
              <button onClick={() => setTier("free")} className={`rounded-xl border p-3 text-left transition ${tier === "free" ? "border-[#e7b86a] bg-[#e7b86a]/10" : "border-white/12 hover:border-white/25"}`}>
                <p className="text-sm font-bold text-white">Quick film</p>
                <p className="text-[11px] text-emerald-300">Free · no credits</p>
                <p className="mt-1 text-[10px] text-white/45">Smooth pan/zoom motion, narration + music.</p>
              </button>
              <button onClick={() => setTier("cinematic")} className={`rounded-xl border p-3 text-left transition ${tier === "cinematic" ? "border-[#c98bff] bg-[#c98bff]/10" : "border-white/12 hover:border-white/25"}`}>
                <p className="text-sm font-bold text-white">Cinematic ✨</p>
                <p className="text-[11px] text-[#cda7ff]">Premium · uses fal credits</p>
                <p className="mt-1 text-[10px] text-white/45">AI animates each photo (Kling/Veo).</p>
              </button>
            </div>
            {tier === "cinematic" && <p className="mb-3 rounded-lg border border-[#c98bff]/30 bg-[#c98bff]/10 px-3 py-2 text-[11px] text-[#e3d2ff]">⚠ This render will spend fal credits (one paid render). Quick film is free.</p>}
            <button onClick={start} disabled={starting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#e7b86a] to-[#ef6d5b] py-3 font-semibold text-[#1c1230] disabled:opacity-60">
              {starting ? <Loader2 className="animate-spin" size={16} /> : <Film size={16} />} {tier === "cinematic" ? "Create Cinematic Movie (paid)" : "Create Quick Movie (free)"}
            </button>
            {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
          </>
        )}

        {rendering && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-white/85"><Loader2 className="animate-spin text-[#e7b86a]" size={18} /><span className="text-sm">{movie?.stage || "Starting the render…"}</span></div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-[#e7b86a] to-[#ef6d5b] transition-all" style={{ width: `${Math.max(5, pct)}%` }} /></div>
            <p className="text-right text-xs text-white/50">{pct}%</p>
            <button onClick={stop} className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-400/40 py-2.5 text-sm font-semibold text-rose-300 hover:bg-rose-500/10"><Square size={14} /> Stop render</button>
            <p className="text-center text-[11px] text-white/40">You can leave — it keeps rendering. Real engines: Gemini · fal Kling/Veo · FFmpeg.</p>
          </div>
        )}

        {ready && (
          <div className="space-y-3">
            <video src={movie!.film_url!} controls autoPlay className="w-full rounded-xl border border-white/10" />
            <p className="flex items-center gap-2 text-sm font-semibold text-emerald-300"><Play size={14} /> {movie?.title || "Your Travel Movie"} — ready ✨</p>
            <div className="flex gap-2">
              <a href={movie!.film_url!} download className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#7b53d4] py-2.5 text-sm font-semibold text-white"><Download size={15} /> Save / Download</a>
              <button onClick={del} className="flex items-center justify-center gap-2 rounded-xl border border-rose-400/40 px-4 py-2.5 text-sm text-rose-300 hover:bg-rose-500/10"><Trash2 size={15} /> Delete</button>
            </div>
          </div>
        )}

        {(failed || cancelled) && !ready && (
          <div className="space-y-3">
            <p className={`text-sm ${failed ? "text-rose-300" : "text-white/70"}`}>{failed ? "Render failed — try again with a couple more photos." : "Render stopped."}</p>
            <div className="flex gap-2">
              <button onClick={() => setMovie(null)} className="flex-1 rounded-xl bg-[#7b53d4] py-2.5 text-sm font-semibold text-white">Try again</button>
              <button onClick={del} className="rounded-xl border border-rose-400/40 px-4 py-2.5 text-sm text-rose-300"><Trash2 size={15} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
