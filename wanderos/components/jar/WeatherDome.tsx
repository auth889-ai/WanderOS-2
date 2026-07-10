"use client";

/** Emotional Weather Dome — a full-scene weather overlay driven by the memory's emotion (free, pure CSS). */
export function WeatherDome({ weather = "cherry_blossom" }: { weather?: string }) {
  return (
    <div className="pointer-events-none fixed inset-0 -z-[5] overflow-hidden">
      <style>{`
        @keyframes wdFall { 0%{ transform:translateY(-12vh) } 100%{ transform:translateY(112vh) } }
        @keyframes wdDrift { 0%{ transform:translateY(-12vh) translateX(0) rotate(0) } 100%{ transform:translateY(112vh) translateX(50px) rotate(320deg) } }
        @keyframes wdTwinkle { 0%,100%{ opacity:.2 } 50%{ opacity:1 } }
        @keyframes wdRays { 0%,100%{ opacity:.3 } 50%{ opacity:.65 } }
      `}</style>

      {weather === "soft_rain" && Array.from({ length: 60 }).map((_, i) => (
        <span key={i} className="absolute block w-[1px] bg-gradient-to-b from-transparent via-sky-200/60 to-transparent" style={{ left: `${(i * 1.7) % 100}%`, height: `${14 + (i % 5) * 6}px`, animation: `wdFall ${0.7 + (i % 5) * 0.15}s linear infinite`, animationDelay: `${(i % 10) * 0.1}s`, transform: "rotate(12deg)" }} />
      ))}

      {weather === "snow" && Array.from({ length: 50 }).map((_, i) => (
        <span key={i} className="absolute rounded-full bg-white/80" style={{ left: `${(i * 2.1) % 100}%`, width: `${2 + (i % 3) * 2}px`, height: `${2 + (i % 3) * 2}px`, animation: `wdDrift ${6 + (i % 6)}s linear infinite`, animationDelay: `${(i % 8) * 0.5}s`, opacity: 0.85 }} />
      ))}

      {weather === "cherry_blossom" && Array.from({ length: 26 }).map((_, i) => (
        <span key={i} className="absolute text-sm" style={{ left: `${(i * 4) % 100}%`, color: "#f7c2dc", animation: `wdDrift ${9 + (i % 7)}s linear infinite`, animationDelay: `${i * 0.8}s`, opacity: 0.8 }}>🌸</span>
      ))}

      {(weather === "temple_bells" || weather === "golden_sunset") && Array.from({ length: 28 }).map((_, i) => (
        <span key={i} className="absolute rounded-full" style={{ left: `${(i * 3.7) % 100}%`, top: `${(i * 5) % 100}%`, width: "3px", height: "3px", background: "#ffd9a0", boxShadow: "0 0 6px #ffb86a", animation: `wdTwinkle ${2 + (i % 5)}s ease-in-out infinite`, animationDelay: `${i * 0.3}s` }} />
      ))}
      {weather === "golden_sunset" && <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 20%, rgba(255,180,90,0.18), transparent 55%)", animation: "wdRays 5s ease-in-out infinite" }} />}

      {weather === "starlight" && Array.from({ length: 60 }).map((_, i) => (
        <span key={i} className="absolute rounded-full bg-white" style={{ left: `${(i * 1.7) % 100}%`, top: `${(i * 2.3) % 100}%`, width: "2px", height: "2px", animation: `wdTwinkle ${1.5 + (i % 6) * 0.5}s ease-in-out infinite`, animationDelay: `${i * 0.2}s` }} />
      ))}
    </div>
  );
}
