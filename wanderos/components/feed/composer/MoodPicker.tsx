"use client";
const MOODS = [
  { v: "joyful", label: "✨ Joyful" }, { v: "adventurous", label: "🏔 Adventurous" }, { v: "serene", label: "🌅 Serene" },
  { v: "nostalgic", label: "🎞 Nostalgic" }, { v: "luxe", label: "💎 Luxe" }, { v: "foodie", label: "🍜 Foodie" }
];
export function MoodPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="rounded-[20px] border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl">
      <p className="mb-3 text-sm font-semibold text-white">Vibe <span className="font-normal text-white/45">— guides the AI caption</span></p>
      <div className="flex flex-wrap gap-2">
        {MOODS.map((m) => (
          <button key={m.v} onClick={() => onChange(m.v)} className={`rounded-full px-3 py-1.5 text-sm transition ${value === m.v ? "bg-gradient-to-r from-coral to-mist text-night" : "border border-white/12 bg-white/5 text-white/70 hover:bg-white/10"}`}>{m.label}</button>
        ))}
      </div>
    </div>
  );
}
