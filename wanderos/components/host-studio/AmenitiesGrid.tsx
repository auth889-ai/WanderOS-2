"use client";

import { useState } from "react";

/** Quick-pick presets — NOT a fixed list. The AI adds whatever it detects in the photos, and the host
 *  can add unlimited custom amenities; these just appear as extra boxes for convenience. */
const PRESETS = [
  "Pool", "WiFi", "Kitchen", "Washer", "Dryer", "Parking", "TV", "Essentials", "Hot Tub", "Air conditioning",
  "Heating", "Workspace", "Balcony", "City View", "Garden", "Breakfast", "Fireplace", "Gym", "Beach Access", "Pet Friendly"
];

/**
 * Amenities editor — grid of selectable boxes. The list is UNLIMITED and DYNAMIC: every amenity the AI
 * detected from the photos shows as a box (50 detected → 50 boxes), presets appear as extra boxes, and
 * the host can add any custom amenity. Selected boxes are highlighted; tap to toggle.
 */
export function AmenitiesGrid({ selected, onChange }: { selected: string[]; onChange: (next: string[]) => void }) {
  const [custom, setCustom] = useState("");
  // AI-detected first (so they're visible up top), then presets the AI didn't already include
  const options = Array.from(new Set([...selected, ...PRESETS]));

  const toggle = (a: string) => onChange(selected.includes(a) ? selected.filter((x) => x !== a) : [...selected, a]);
  const addCustom = () => {
    const v = custom.trim();
    if (v && !selected.some((s) => s.toLowerCase() === v.toLowerCase())) onChange([...selected, v]);
    setCustom("");
  };

  return (
    <div>
      <p className="mb-3 text-xs text-white/45">
        {selected.length} selected — the AI added what it saw in your photos; tap to toggle, or add your own (no limit).
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {options.map((a) => {
          const on = selected.includes(a);
          return (
            <button
              key={a}
              type="button"
              onClick={() => toggle(a)}
              className={`rounded-xl border px-4 py-3 text-left text-sm transition ${
                on ? "border-coral bg-coral/20 text-white" : "border-white/10 bg-black/20 text-white/80 hover:bg-white/10"
              }`}
            >
              {a}
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex gap-3">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustom())}
          placeholder="Add anything the AI missed — e.g. 'Karaoke room', 'Indoor playground', 'PS5'…"
          className="flex-1 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none placeholder:text-white/30 focus:border-coral"
        />
        <button type="button" onClick={addCustom} className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-white transition hover:bg-white/10">
          Add
        </button>
      </div>
    </div>
  );
}
