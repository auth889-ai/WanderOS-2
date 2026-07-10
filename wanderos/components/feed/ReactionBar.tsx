"use client";
import { useState } from "react";
import { reactPost } from "@/lib/api/posts-client";
const REACTIONS = [["like","👍"],["love","❤️"],["fire","🔥"],["wow","😮"]] as const;
export function ReactionBar({ postId, initialCount }: { postId: string; initialCount: number }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [count, setCount] = useState(initialCount);
  const [open, setOpen] = useState(false);
  async function react(kind: string) {
    const same = picked === kind;
    setPicked(same ? null : kind);
    setCount((c) => c + (same ? -1 : picked ? 0 : 1));
    setOpen(false);
    await reactPost(postId, kind, !same);
  }
  const current = REACTIONS.find(([k]) => k === picked);
  return (
    <div className="relative" onMouseLeave={() => setOpen(false)}>
      <button onMouseEnter={() => setOpen(true)} onClick={() => react(picked ?? "like")}
        className={`flex items-center gap-1.5 text-sm font-medium transition ${picked ? "text-[#ef6d5b]" : "text-[#8a7e76] hover:text-[#312b27]"}`}>
        <span key={picked ?? "base"} className="inline-block text-lg animate-pop">{current ? current[1] : "👍"}</span> {count > 0 && count}
      </button>
      {open && (
        <div className="absolute -top-11 left-0 flex gap-1 rounded-full border border-[#f0e6dc] bg-white px-2 py-1.5 shadow-lg">
          {REACTIONS.map(([k, e]) => <button key={k} onClick={() => react(k)} className="text-xl transition hover:scale-125">{e}</button>)}
        </div>
      )}
    </div>
  );
}
