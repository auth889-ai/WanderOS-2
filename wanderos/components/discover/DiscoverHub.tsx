"use client";

import { useState } from "react";
import { CalendarHeart, Radar } from "lucide-react";
import { HolidayConcierge } from "./HolidayConcierge";
import { TravelRadar } from "./TravelRadar";

/** Discover hub — one structured surface with a top switch between the holiday-first concierge and destination search. */
export function DiscoverHub() {
  const [mode, setMode] = useState<"holidays" | "explore">("holidays");

  const btn = (active: boolean) =>
    `flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${active ? "bg-[#ef6d5b] text-white shadow-[0_8px_22px_rgba(239,109,91,0.35)]" : "text-white/65 hover:bg-white/10 hover:text-white"}`;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex gap-1 rounded-2xl border border-white/12 bg-black/30 p-1 backdrop-blur-xl">
        <button onClick={() => setMode("holidays")} className={btn(mode === "holidays")}><CalendarHeart size={16} /> My Holidays</button>
        <button onClick={() => setMode("explore")} className={btn(mode === "explore")}><Radar size={16} /> Explore a place</button>
      </div>

      {mode === "holidays" ? <HolidayConcierge /> : <TravelRadar />}
    </div>
  );
}
