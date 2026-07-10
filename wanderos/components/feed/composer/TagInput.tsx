"use client";
import { useState, type KeyboardEvent } from "react";
import { Hash, X } from "lucide-react";
export function TagInput({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [input, setInput] = useState("");
  function add(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && input.trim()) {
      e.preventDefault();
      const t = input.trim().replace(/^#/, "");
      if (t && !tags.includes(t) && tags.length < 8) onChange([...tags, t]);
      setInput("");
    }
  }
  return (
    <label className="block text-sm font-semibold text-white">Tags
      <div className="relative mt-2"><Hash size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
        <input className="w-full rounded-xl border border-white/12 bg-white/5 py-2.5 pl-9 pr-3 text-sm text-white outline-none focus:border-coral" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={add} placeholder="type a tag, press Enter" /></div>
      {tags.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{tags.map((t) => <span key={t} className="inline-flex items-center gap-1 rounded-full bg-mist/15 px-2.5 py-1 text-xs text-mist">#{t}<button onClick={() => onChange(tags.filter((y) => y !== t))}><X size={11} /></button></span>)}</div>}
    </label>
  );
}
