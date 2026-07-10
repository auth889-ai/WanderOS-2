"use client";

import { Heart, Sparkles } from "lucide-react";

/** The Living Memory Jar — displays the fal-generated photoreal magical jar as a breathing, glowing, floating centerpiece, with orbiting sparkles + floating polaroids overlaid. */
export function LivingJar({ image, glow = "#e7b86a", particle = "sakura", caption, photos = [] }: { image?: string | null; glow?: string; particle?: "sakura" | "rain" | "sparks" | "snow" | "fireflies"; caption?: string; photos?: string[] }) {
  const particleChar = { sakura: "🌸", rain: "💧", sparks: "✦", snow: "❄", fireflies: "•" }[particle];
  const polas = photos.slice(0, 3);
  return (
    <div className="relative mx-auto flex w-full max-w-[440px] flex-col items-center">
      <style>{`
        @keyframes jarFloat { 0%,100%{ transform:translateY(0) } 50%{ transform:translateY(-12px) } }
        @keyframes jarGlow { 0%,100%{ opacity:.45 } 50%{ opacity:.9 } }
        @keyframes orbitP { from{ transform:rotate(0deg) translateX(195px) rotate(0deg) } to{ transform:rotate(360deg) translateX(195px) rotate(-360deg) } }
        @keyframes beat { 0%,100%{ transform:scale(1) } 30%{ transform:scale(1.3) } }
        @keyframes polaFloat { 0%,100%{ transform:translateY(0) rotate(var(--r)) } 50%{ transform:translateY(-12px) rotate(var(--r)) } }
      `}</style>

      {/* glow aura */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl" style={{ background: `radial-gradient(circle, ${glow}66, #d96a9a22 45%, transparent 70%)`, animation: "jarGlow 4.5s ease-in-out infinite" }} />

      {/* orbiting sparkles */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-0 w-0">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <span key={i} className="absolute text-sm" style={{ color: glow, animation: `orbitP ${10 + i * 1.4}s linear infinite`, animationDelay: `${i * 1.1}s`, opacity: 0.85, filter: `drop-shadow(0 0 5px ${glow})` }}>{particleChar}</span>
        ))}
      </div>

      {/* floating polaroids from real photos */}
      {polas.map((src, i) => {
        const pos = [{ top: "10%", right: "-4%", r: "8deg" }, { top: "44%", right: "-7%", r: "-6deg" }, { top: "26%", left: "-6%", r: "-10deg" }][i];
        return (
          <div key={i} className="absolute z-30 hidden rounded-[4px] border-2 border-white/85 bg-white/90 p-1 shadow-2xl sm:block" style={{ ...pos, ["--r" as string]: pos.r, animation: `polaFloat ${5 + i}s ease-in-out infinite`, animationDelay: `${i * 0.8}s` } as React.CSSProperties}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" className="h-14 w-16 rounded-[2px] object-cover" />
          </div>
        );
      })}

      {/* the generated jar */}
      <div style={{ animation: "jarFloat 6.5s ease-in-out infinite" }} className="relative z-10">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="Living Memory Jar" className="h-auto w-[380px] max-w-full" style={{ filter: `drop-shadow(0 0 45px ${glow}66)`, maskImage: "radial-gradient(ellipse 78% 84% at 50% 46%, #000 60%, transparent 94%)", WebkitMaskImage: "radial-gradient(ellipse 78% 84% at 50% 46%, #000 60%, transparent 94%)" }} />
        ) : (
          <div className="grid h-[440px] w-[330px] place-items-center rounded-[30px] border border-white/20 bg-gradient-to-b from-[#4a2e6e] to-[#2a1f4a] text-white/40">
            <Sparkles className="animate-pulse" /> <span className="mt-2 text-xs">Conjuring your jar…</span>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs text-white/75">
        <Heart size={13} fill={glow} stroke={glow} style={{ animation: "beat 1.4s ease-in-out infinite" }} /> Memory Heartbeat
      </div>
      {caption && <p className="mt-1 max-w-sm text-center text-xs italic text-white/60">{caption}</p>}
    </div>
  );
}
