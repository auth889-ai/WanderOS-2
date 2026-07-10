"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, X } from "lucide-react";
import { addTripItem } from "@/lib/api/trips";

export function AddItineraryItemForm({ tripId, dayNumber }: { tripId: string; dayNumber: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    timeLabel: "",
    title: "",
    description: "",
    category: "",
    estCost: 0
  });

  function submit() {
    setError("");
    startTransition(async () => {
      try {
        await addTripItem(tripId, {
          dayNumber,
          timeLabel: form.timeLabel || null,
          title: form.title,
          description: form.description || null,
          category: form.category || null,
          estCost: form.estCost
        });
        setForm({ timeLabel: "", title: "", description: "", category: "", estCost: 0 });
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to add item.");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-[8px] border border-dashed border-[#d87562]/45 bg-[#fff8ef] px-3 py-2 text-xs font-semibold text-[#b85e4f] transition hover:bg-[#fff2e6]"
      >
        <Plus className="h-3.5 w-3.5" />
        Add item
      </button>
    );
  }

  return (
    <div className="rounded-[8px] border border-[#f1c9ad] bg-[#fff8ef] p-3">
      <div className="grid gap-2 sm:grid-cols-[110px_1fr]">
        <input
          value={form.timeLabel}
          onChange={(event) => setForm((next) => ({ ...next, timeLabel: event.target.value }))}
          className="rounded-[8px] border border-[#edc9ad] bg-[#fffdf8] px-3 py-2 text-xs text-[#4b4038] outline-none focus:border-[#d87562]"
          placeholder="Time"
        />
        <input
          value={form.title}
          onChange={(event) => setForm((next) => ({ ...next, title: event.target.value }))}
          className="rounded-[8px] border border-[#edc9ad] bg-[#fffdf8] px-3 py-2 text-sm font-semibold text-[#4b4038] outline-none focus:border-[#d87562]"
          placeholder="New activity"
        />
      </div>
      <textarea
        value={form.description}
        onChange={(event) => setForm((next) => ({ ...next, description: event.target.value }))}
        className="mt-2 min-h-[74px] w-full rounded-[8px] border border-[#edc9ad] bg-[#fffdf8] px-3 py-2 text-sm text-[#4b4038] outline-none focus:border-[#d87562]"
        placeholder="Why this belongs in the day"
      />
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_120px]">
        <input
          value={form.category}
          onChange={(event) => setForm((next) => ({ ...next, category: event.target.value }))}
          className="rounded-[8px] border border-[#edc9ad] bg-[#fffdf8] px-3 py-2 text-sm text-[#4b4038] outline-none focus:border-[#d87562]"
          placeholder="Category"
        />
        <input
          type="number"
          min="0"
          value={form.estCost}
          onChange={(event) => setForm((next) => ({ ...next, estCost: Number(event.target.value || 0) }))}
          className="rounded-[8px] border border-[#edc9ad] bg-[#fffdf8] px-3 py-2 text-sm text-[#4b4038] outline-none focus:border-[#d87562]"
          placeholder="Cost"
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={isPending || !form.title.trim()}
          onClick={submit}
          className="inline-flex items-center gap-2 rounded-[8px] bg-[#d87562] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#c96451] disabled:opacity-60"
        >
          <Save className="h-3.5 w-3.5" />
          Save
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex items-center gap-2 rounded-[8px] border border-[#edc9ad] bg-white px-3 py-2 text-xs font-semibold text-[#7b5f4b]"
        >
          <X className="h-3.5 w-3.5" />
          Cancel
        </button>
        {error ? <span className="text-xs text-[#b44131]">{error}</span> : null}
      </div>
    </div>
  );
}
