"use client";
import { useEffect, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

export type LightboxItem = { url: string; kind: "photo" | "video" };

/** Fullscreen viewer that navigates ALL of a post's media (prev/next + keyboard). */
export function Lightbox({ items, startIndex, onClose }: { items: LightboxItem[] | null; startIndex: number; onClose: () => void }) {
  const [i, setI] = useState(startIndex);
  useEffect(() => setI(startIndex), [startIndex]);
  useEffect(() => {
    if (!items) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((x) => Math.min(x + 1, items.length - 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(x - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, onClose]);
  if (!items || !items.length) return null;
  const item = items[Math.min(i, items.length - 1)];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/92 p-6 backdrop-blur" onClick={onClose}>
      <button className="absolute right-5 top-5 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25"><X size={20} /></button>
      {items.length > 1 && i > 0 && (
        <button onClick={(e) => { e.stopPropagation(); setI((x) => x - 1); }} className="absolute left-4 grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25"><ChevronLeft size={22} /></button>
      )}
      {item.kind === "video"
        ? <video src={item.url} controls autoPlay className="max-h-[88vh] max-w-[92vw] rounded-xl" onClick={(e) => e.stopPropagation()} />
        // eslint-disable-next-line @next/next/no-img-element
        : <img src={item.url} alt="" className="max-h-[88vh] max-w-[92vw] rounded-xl object-contain" onClick={(e) => e.stopPropagation()} />}
      {items.length > 1 && i < items.length - 1 && (
        <button onClick={(e) => { e.stopPropagation(); setI((x) => x + 1); }} className="absolute right-4 grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25"><ChevronRight size={22} /></button>
      )}
      {items.length > 1 && <p className="absolute bottom-5 rounded-full bg-black/60 px-3 py-1 text-sm text-white">{i + 1} / {items.length}</p>}
    </div>
  );
}
