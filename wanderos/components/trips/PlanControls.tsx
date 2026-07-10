"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Send } from "lucide-react";
import { refineTripPlan, regenerateTripPlan } from "@/lib/api/trips";

export function PlanControls({ tripId }: { tripId: string }) {
  const router = useRouter();
  const [instruction, setInstruction] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function runRegenerate() {
    setMessage("");
    startTransition(async () => {
      try {
        await regenerateTripPlan(tripId, "Create a fresh plan around the same traveler constraints.");
        setMessage("Regeneration queued.");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not regenerate this trip.");
      }
    });
  }

  function runRefine() {
    const value = instruction.trim();
    if (value.length < 3) {
      setMessage("Add a short refinement.");
      return;
    }
    setMessage("");
    startTransition(async () => {
      try {
        await refineTripPlan(tripId, value);
        setInstruction("");
        setMessage("Refinement queued.");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not refine this trip.");
      }
    });
  }

  return (
    <section className="rounded-[8px] border border-[#f2cfb0] bg-[#fffaf2]/95 p-4 text-[#4b4038] shadow-[0_18px_40px_rgba(50,31,18,0.18)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#d87562]">Refine</p>
          <h2 className="mt-1 text-lg font-semibold text-[#4a4038]">New version</h2>
        </div>
        <button
          type="button"
          onClick={runRegenerate}
          disabled={isPending}
          className="inline-flex h-10 w-10 items-center justify-center rounded-[8px] border border-[#f2cfb0] bg-[#fff3e6] text-[#d87562] transition hover:border-[#ff9a83] hover:bg-[#ffe8dc] disabled:opacity-60"
          title="Regenerate"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-4 flex gap-2">
        <input
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="make it cheaper, add a beach day"
          className="min-w-0 flex-1 rounded-[8px] border border-[#f2cfb0] bg-[#fffdf8] px-3 py-3 text-sm font-medium text-[#483b32] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_22px_rgba(58,38,24,0.10)] outline-none transition placeholder:text-[#a98a74] focus:border-[#ff806e] focus:ring-4 focus:ring-[#ff806e]/20"
        />
        <button
          type="button"
          onClick={runRefine}
          disabled={isPending}
          className="inline-flex h-11 w-11 items-center justify-center rounded-[8px] bg-[#ff806e] text-white shadow-[0_12px_24px_rgba(255,128,110,0.25)] transition hover:bg-[#ff6f5d] disabled:opacity-60"
          title="Send refinement"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
      {message ? <p className="mt-3 text-sm text-[#856b59]">{message}</p> : null}
    </section>
  );
}
