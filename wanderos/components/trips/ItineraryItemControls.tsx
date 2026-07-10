"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, Pencil, Save, Trash2, Unlock, X } from "lucide-react";
import { deleteTripItem, updateTripItem } from "@/lib/api/trips";

export type EditableTripItem = {
  id: string;
  time_label: string | null;
  title: string;
  description: string | null;
  category: string | null;
  est_cost: string;
  locked: boolean;
};

export function ItineraryItemControls({ tripId, item }: { tripId: string; item: EditableTripItem }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    timeLabel: item.time_label || "",
    title: item.title,
    description: item.description || "",
    category: item.category || "",
    estCost: Number(item.est_cost || 0)
  });

  function refreshAfter(action: () => Promise<unknown>) {
    setError("");
    startTransition(async () => {
      try {
        await action();
        setEditing(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Item update failed.");
      }
    });
  }

  if (editing) {
    return (
      <div className="mt-3 space-y-2 rounded-[8px] border border-[#f1c9ad] bg-[#fff8ef] p-3">
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
            placeholder="Activity title"
          />
        </div>
        <textarea
          value={form.description}
          onChange={(event) => setForm((next) => ({ ...next, description: event.target.value }))}
          className="min-h-[84px] w-full rounded-[8px] border border-[#edc9ad] bg-[#fffdf8] px-3 py-2 text-sm text-[#4b4038] outline-none focus:border-[#d87562]"
          placeholder="Description"
        />
        <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
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
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              refreshAfter(() =>
                updateTripItem(tripId, item.id, {
                  timeLabel: form.timeLabel || null,
                  title: form.title,
                  description: form.description || null,
                  category: form.category || null,
                  estCost: form.estCost
                })
              )
            }
            className="inline-flex items-center gap-2 rounded-[8px] bg-[#d87562] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#c96451] disabled:opacity-60"
          >
            <Save className="h-3.5 w-3.5" />
            Save
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
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

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#edc9ad] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#765d49]"
      >
        <Pencil className="h-3.5 w-3.5" />
        Edit
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={() => refreshAfter(() => updateTripItem(tripId, item.id, { locked: !item.locked }))}
        className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#edc9ad] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#765d49] disabled:opacity-60"
      >
        {item.locked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
        {item.locked ? "Unlock" : "Lock"}
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={() => refreshAfter(() => deleteTripItem(tripId, item.id))}
        className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#f0b9aa] bg-[#fff2ef] px-2.5 py-1.5 text-xs font-semibold text-[#ad4838] disabled:opacity-60"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete
      </button>
      {error ? <span className="text-xs text-[#b44131]">{error}</span> : null}
    </div>
  );
}
