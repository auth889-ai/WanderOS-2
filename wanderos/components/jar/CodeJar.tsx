"use client";

import { Heart, Sparkles } from "lucide-react";

/**
 * Dynamic jar — keeps the EXACT #36 jar shape by using the #36 image as a photoreal frame,
 * and overlays the user's chosen scene (Unsplash/photo) into its inner glass window. Free + unlimited, any place.
 */
export function CodeJar({ scene, glow = "#e7b86a", caption, photos = [] }: { scene?: string | null; glow?: string; caption?: string; photos?: string[] }) {
  const polas = photos.slice(0, 3);
  return (
    <div className="relative mx-auto flex w-full max-w-[440px] flex-col items-center">
      <style>{`
        @keyframes cjFloat { 0%,100%{ transform:translateY(0) } 50%{ transform:translateY(-11px) } }
        @keyframes cjGlow { 0%,100%{ opacity:.45 } 50%{ opacity:.9 } }
        @keyframes cjOrbit { from{ transform:rotate(0deg) translateX(190px) rotate(0deg) } to{ transform:rotate(360deg) translateX(190px) rotate(-360deg) } }
        @keyframes cjPola { 0%,100%{ transform:translateY(0) rotate(var(--r)) } 50%{ transform:translateY(-12px) rotate(var(--r)) } }
      `}</style>

      {/* glow aura */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl" style={{ background: `radial-gradient(circle, ${glow}66, #d96a9a22 45%, transparent 70%)`, animation: "cjGlow 4.5s ease-in-out infinite" }} />

      {/* orbiting sparkles */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-0 w-0">
        {[0, 1, 2, 3, 4, 5].map((i) => <span key={i} className="absolute text-sm" style={{ color: glow, animation: `cjOrbit ${10 + i * 1.5}s linear infinite`, animationDelay: `${i}s`, filter: `drop-shadow(0 0 5px ${glow})` }}>✦</span>)}
      </div>

      {/* floating polaroids */}
      {polas.map((src, i) => {
        const pos = [{ top: "12%", right: "-4%", r: "8deg" }, { top: "46%", right: "-7%", r: "-6deg" }, { top: "28%", left: "-6%", r: "-10deg" }][i];
        return <div key={i} className="absolute z-30 hidden rounded-[4px] border-2 border-white/85 bg-white/90 p-1 shadow-2xl sm:block" style={{ ...pos, ["--r" as string]: pos.r, animation: `cjPola ${5 + i}s ease-in-out infinite`, animationDelay: `${i * 0.8}s` } as React.CSSProperties}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={src} alt="" className="h-14 w-16 rounded-[2px] object-cover" /></div>;
      })}

      {/* the jar — #36 photoreal frame, with the dynamic scene overlaid into the inner glass window */}
      <div style={{ animation: "cjFloat 6.5s ease-in-out infinite" }} className="relative z-10 w-[380px] max-w-full">
        {/* #36 frame (gold lid, glass rim, base, ribbons, heart) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/jar/templates/t0.png" alt="Memory Jar" className="relative z-0 w-full" style={{ filter: `drop-shadow(0 0 45px ${glow}55)` }} />
        {/* dynamic scene on TOP — fills the glass body, cylinder-curved + feathered so it reads as truly inside the jar */}
        <div className="absolute z-10 overflow-hidden" style={{ left: "20.5%", top: "24%", width: "59%", height: "54%", borderRadius: "13% / 8%", maskImage: "radial-gradient(ellipse 95% 98% at 50% 50%, #000 80%, transparent 99.5%)", WebkitMaskImage: "radial-gradient(ellipse 95% 98% at 50% 50%, #000 80%, transparent 99.5%)" }}>
          {scene
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={scene} alt="" className="h-full w-full object-cover" />
            : <div className="grid h-full w-full place-items-center bg-gradient-to-b from-[#3a2b66] to-[#241338] text-white/40"><Sparkles className="animate-pulse" /></div>}
          {/* glass CYLINDER shading — darker curved left/right edges so the scene wraps inside the round glass */}
          <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(18,8,28,0.55), transparent 15%, transparent 85%, rgba(18,8,28,0.55)), linear-gradient(180deg, rgba(255,225,180,0.18), transparent 24%, rgba(38,14,48,0.4))" }} />
          {/* bright glass highlight streak */}
          <div className="absolute left-3 top-2 h-3/4 w-3.5 -rotate-12 rounded-full bg-white/30 blur-md" />
          <div className="absolute right-4 top-3 h-1/2 w-2 rounded-full bg-white/15 blur-sm" />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs text-white/75"><Heart size={13} fill={glow} stroke={glow} className="animate-pulse" /> Memory Heartbeat</div>
      {caption && <p className="mt-1 max-w-sm text-center text-xs italic text-white/60">{caption}</p>}
    </div>
  );
}
