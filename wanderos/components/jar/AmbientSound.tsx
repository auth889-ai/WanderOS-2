"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

type Cfg = { cut: number; vol: number; wave?: boolean; bells?: boolean; label: string };
const CFG: Record<string, Cfg> = {
  soft_rain: { cut: 1800, vol: 0.1, label: "Rain" },
  snow: { cut: 480, vol: 0.06, wave: true, label: "Snow wind" },
  cherry_blossom: { cut: 700, vol: 0.05, wave: true, label: "Spring breeze" },
  golden_sunset: { cut: 420, vol: 0.05, wave: true, label: "Evening calm" },
  temple_bells: { cut: 520, vol: 0.05, bells: true, label: "Temple bells" },
  starlight: { cut: 300, vol: 0.04, label: "Night hush" }
};

/** Ambient location sound — synthesized via Web Audio (no files, free). Matches the memory's emotional weather. */
export function AmbientSound({ weather = "cherry_blossom" }: { weather?: string }) {
  const [on, setOn] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodes = useRef<{ stop?: () => void; disconnect?: () => void }[]>([]);
  const cfg = CFG[weather] ?? CFG.cherry_blossom;

  function stop() {
    nodes.current.forEach((n) => { try { n.stop?.(); n.disconnect?.(); } catch { /* noop */ } });
    nodes.current = [];
    try { ctxRef.current?.close(); } catch { /* noop */ }
    ctxRef.current = null;
  }

  function start() {
    stop();
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx(); ctxRef.current = ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = cfg.cut;
    const gain = ctx.createGain(); gain.gain.value = cfg.vol;
    noise.connect(lp); lp.connect(gain); gain.connect(ctx.destination); noise.start();
    nodes.current.push(noise);
    if (cfg.wave) { const lfo = ctx.createOscillator(); lfo.frequency.value = 0.1; const lg = ctx.createGain(); lg.gain.value = cfg.vol * 0.6; lfo.connect(lg); lg.connect(gain.gain); lfo.start(); nodes.current.push(lfo); }
    if (cfg.bells) {
      const ring = () => {
        if (ctxRef.current !== ctx) return;
        const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = [523, 659, 784][Math.floor(Math.random() * 3)];
        const g = ctx.createGain(); const t = ctx.currentTime;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
        o.connect(g); g.connect(ctx.destination); o.start(); o.stop(t + 2.7);
        setTimeout(ring, 3000 + Math.random() * 3500);
      };
      ring();
    }
  }

  useEffect(() => { if (on) start(); else stop(); return stop; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [on, weather]);

  return (
    <button onClick={() => setOn((s) => !s)} title="Ambient sound" className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${on ? "border-[#e7b86a] bg-[#e7b86a]/15 text-[#e7b86a]" : "border-white/15 bg-white/5 text-white/70 hover:border-white/30"}`}>
      {on ? <Volume2 size={14} /> : <VolumeX size={14} />} {on ? cfg.label : "Ambient"}
    </button>
  );
}
