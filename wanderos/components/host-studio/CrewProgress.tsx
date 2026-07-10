"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { STUDIO_STAGES } from "@/lib/hooks/useStudioJob";

/** Live "watch the crew work" view — props-only; the hook feeds it progress/stage/error. */
export function CrewProgress({ progress, stage, error, onRetry }: { progress: number; stage: string; error: string; onRetry: () => void }) {
  const doneCount = Math.round((progress / 100) * STUDIO_STAGES.length);
  return (
    <div className="glass rounded-[28px] p-9">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-mist">The crew is working</p>
          <h2 className="mt-1 text-3xl font-semibold">{stage}</h2>
        </div>
        <div className="text-5xl font-bold tabular-nums text-coral">{progress}%</div>
      </div>

      <div className="mt-6 h-3 overflow-hidden rounded-full bg-white/10">
        <motion.div className="h-full rounded-full bg-gradient-to-r from-coral via-peach to-mist" animate={{ width: `${progress}%` }} transition={{ ease: "easeOut" }} />
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {STUDIO_STAGES.map((s, i) => {
          const done = i < doneCount;
          const active = i === doneCount;
          return (
            <motion.div
              key={s}
              animate={{ opacity: done || active ? 1 : 0.5 }}
              className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition ${
                done ? "border-mist/40 bg-mist/10 text-white" : active ? "border-coral/50 bg-coral/10 text-white" : "border-white/10 bg-white/5 text-white/45"
              }`}
            >
              <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-semibold ${done ? "bg-mist text-night" : active ? "bg-coral text-night" : "bg-white/10"}`}>
                {done ? "✓" : active ? "●" : i + 1}
              </span>
              {s}
            </motion.div>
          );
        })}
      </div>

      {error && (
        <div className="mt-6 rounded-2xl border border-coral/40 bg-coral/10 px-4 py-4">
          <p className="text-sm text-peach">{error}</p>
          <Button variant="ghost" onClick={onRetry} className="mt-3">Try again</Button>
        </div>
      )}
    </div>
  );
}
