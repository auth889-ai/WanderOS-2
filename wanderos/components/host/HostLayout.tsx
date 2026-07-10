"use client";

import { useEffect, useState } from "react";
import { CursorGlow } from "./CursorGlow";
import { HostTopbar } from "./HostTopbar";
import { HostSidebar } from "./HostSidebar";

/**
 * Premium cinematic host shell — faithful to travelmate's HostLayout:
 *   rotating webp backgrounds + slow zoom + crossfade + dark/gradient/glass/ambient overlays + cursor glow.
 * In WanderOS's night/coral/mist palette. Used by host pages instead of the plain AppShell.
 */
const BACKGROUNDS = ["/images/bg/mountain.webp", "/images/bg/lake.webp", "/images/bg/beach.webp", "/images/bg/snow.webp"];

export function HostLayout({
  title,
  subtitle,
  hostName,
  quiet = false,
  children
}: {
  title: string;
  subtitle: string;
  hostName: string;
  /** quiet = calm SOLID background (for content-heavy pages like the listing detail), so cards stay
   *  high-contrast & readable. Default = the cinematic rotating photo (for the studio/dashboard). */
  quiet?: boolean;
  children: React.ReactNode;
}) {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (quiet) return;
    BACKGROUNDS.forEach((src) => {
      const img = new Image();
      img.src = src;
    });
  }, [quiet]);

  useEffect(() => {
    if (quiet) return;
    const t = setInterval(() => setCurrent((p) => (p + 1) % BACKGROUNDS.length), 9000);
    return () => clearInterval(t);
  }, [quiet]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-night text-white">
      {quiet ? (
        // calm, readable surface — no busy photo behind long content
        <>
          <div className="absolute inset-0 bg-gradient-to-b from-grape/40 via-night to-night" />
          <div className="pointer-events-none absolute -top-40 left-1/3 h-[520px] w-[520px] rounded-full bg-coral/10 blur-[200px]" />
          <div className="pointer-events-none absolute bottom-0 right-0 h-[460px] w-[460px] rounded-full bg-mist/10 blur-[200px]" />
        </>
      ) : (
        <>
          {/* rotating cinematic background (zoom + crossfade) */}
          <div
            key={current}
            className="absolute inset-0 h-full w-full animate-bgZoom bg-cover bg-center brightness-[0.7] contrast-110 transition-all duration-[3000ms]"
            style={{ backgroundImage: `url(${BACKGROUNDS[current]})` }}
          />
          <CursorGlow />
          <div className="absolute inset-0 bg-black/45" />
          <div className="absolute inset-0 bg-gradient-to-br from-grape/50 via-transparent to-night/80" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(255,255,255,0.08),transparent_42%)]" />
          <div className="pointer-events-none absolute -left-40 -top-40 h-[600px] w-[600px] rounded-full bg-coral/20 blur-[180px]" />
          <div className="pointer-events-none absolute -bottom-40 -right-40 h-[560px] w-[560px] rounded-full bg-mist/15 blur-[180px]" />
        </>
      )}

      {/* content: left sidebar + (topbar + main) */}
      <div className="relative z-10 flex min-h-screen">
        <HostSidebar hostName={hostName} />
        <div className="flex min-h-screen flex-1 flex-col">
          <HostTopbar title={title} subtitle={subtitle} hostName={hostName} />
          <main className="flex-1 px-6 py-8">
            <div className="mx-auto max-w-6xl">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
