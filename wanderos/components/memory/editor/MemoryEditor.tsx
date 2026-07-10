"use client";

import { useEffect, useRef, type ChangeEvent } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Undo2, Redo2, Save, Plus, Type, ImagePlus, Trash2, ArrowUp, Eye, Loader2, Check } from "lucide-react";
import { useEditor } from "@/lib/memory/editorStore";
import type { MemoryBookRow } from "@/lib/memory/types";
import { SpreadRenderer, MEMORY_THEMES, THEME_SWATCH } from "@/components/memory/SpreadRenderer";
import { uploadPostMedia } from "@/lib/api/posts-client";

const MemoryCanvas = dynamic(() => import("./MemoryCanvas").then((m) => m.MemoryCanvas), {
  ssr: false,
  loading: () => <div className="grid h-[560px] place-items-center text-white/40"><Loader2 className="animate-spin" /></div>
});

const STICKERS = ["🌸", "✨", "🧭", "✈️", "🌅", "🍃", "❤️", "📍", "⭐", "🎈"];

export function MemoryEditor({ book }: { book: MemoryBookRow }) {
  const ed = useEditor();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { ed.setDoc(book.doc); }, [book.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // debounced autosave
  useEffect(() => {
    if (!ed.dirty) return;
    const t = setTimeout(async () => {
      await fetch(`/api/memory-books/${book.id}/autosave`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc: ed.doc }) }).catch(() => {});
      ed.markSaved();
    }, 900);
    return () => clearTimeout(t);
  }, [ed.doc, ed.dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const side = ed.selected?.side ?? "left";
  const spread = ed.doc.spreads[ed.activeSpread];
  const selectedLayer = spread && ed.selected
    ? (ed.selected.side === "left" ? spread.leftPage : spread.rightPage).layers.find((l) => l.id === ed.selected!.id) ?? null
    : null;

  function addText() { ed.addLayer(side, { id: ed.newLayerId(), kind: "text", role: "body", x: 140, y: 140, w: 560, h: 140, rotation: 0, text: "New text", source: "user" }); }
  function addSticker(emoji: string) { ed.addLayer(side, { id: ed.newLayerId(), kind: "sticker", x: 160, y: 160, w: 120, h: 120, rotation: 0, text: emoji, source: "user" }); }
  async function addPhoto(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    const url = await uploadPostMedia(f);
    if (url) ed.addLayer(side, { id: ed.newLayerId(), kind: "photo", variant: "framed", x: 160, y: 160, w: 480, h: 480, rotation: 0, src: url, source: "upload" });
    if (fileRef.current) fileRef.current.value = "";
  }
  async function saveSnapshot() {
    await fetch(`/api/memory-books/${book.id}/autosave`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc: ed.doc }) }).catch(() => {});
    ed.markSaved();
  }

  const tool = "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/80 transition hover:bg-white/10";

  return (
    <div className="text-white">
      {/* toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
        <div className="flex items-center gap-1">
          <button onClick={ed.undo} disabled={!ed.past.length} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-white/10 disabled:opacity-30"><Undo2 size={17} /></button>
          <button onClick={ed.redo} disabled={!ed.future.length} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-white/10 disabled:opacity-30"><Redo2 size={17} /></button>
          <span className="ml-2 inline-flex items-center gap-1 text-xs text-white/45">{ed.dirty ? <><Loader2 size={12} className="animate-spin" /> saving…</> : <><Check size={12} /> saved</>}</span>
        </div>
        <p className="truncate text-sm font-semibold">{ed.doc.title || book.title}</p>
        <div className="flex items-center gap-2">
          <Link href={`/memory-books/${book.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 px-3 py-2 text-sm hover:bg-white/10"><Eye size={15} /> Preview</Link>
          <button onClick={saveSnapshot} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-coral to-mist px-3 py-2 text-sm font-semibold text-night"><Save size={15} /> Save</button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[170px_minmax(0,1fr)_220px]">
        {/* left tools */}
        <aside className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="px-1 text-xs uppercase tracking-[0.18em] text-white/40">Add</p>
          <button onClick={() => fileRef.current?.click()} className={tool}><ImagePlus size={16} /> Photo</button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={addPhoto} />
          <button onClick={addText} className={tool}><Type size={16} /> Text</button>
          <p className="px-1 pt-2 text-xs uppercase tracking-[0.18em] text-white/40">Stickers</p>
          <div className="grid grid-cols-5 gap-1">
            {STICKERS.map((s) => <button key={s} onClick={() => addSticker(s)} className="grid h-8 place-items-center rounded-md text-lg hover:bg-white/10">{s}</button>)}
          </div>
          <p className="px-1 pt-2 text-xs uppercase tracking-[0.18em] text-white/40">Theme color</p>
          <div className="grid grid-cols-5 gap-1.5">
            {MEMORY_THEMES.map((t) => (
              <button key={t} onClick={() => ed.setTheme(t)} title={t} style={{ background: THEME_SWATCH[t] }}
                className={`h-7 rounded-md border-2 transition ${ed.doc.theme === t ? "border-coral" : "border-white/20 hover:border-white/60"}`} />
            ))}
          </div>
        </aside>

        {/* canvas */}
        <div className="min-w-0"><MemoryCanvas /></div>

        {/* right panel */}
        <aside className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="px-1 text-xs uppercase tracking-[0.18em] text-white/40">Selected</p>
          {selectedLayer ? (
            <div className="space-y-3">
              <p className="px-1 text-sm font-medium capitalize text-white/80">{selectedLayer.kind}{selectedLayer.role ? ` · ${selectedLayer.role}` : ""}</p>
              {selectedLayer.kind === "text" && (
                <textarea
                  className="w-full rounded-lg border border-white/12 bg-white/5 p-2 text-sm text-white outline-none focus:border-coral"
                  rows={4} value={selectedLayer.text || ""}
                  onChange={(e) => ed.updateLayer(ed.selected!.side, selectedLayer.id, { text: e.target.value })}
                />
              )}
              <label className="block px-1 text-xs text-white/50">Rotation
                <input type="range" min={-30} max={30} value={selectedLayer.rotation || 0}
                  onChange={(e) => ed.updateLayer(ed.selected!.side, selectedLayer.id, { rotation: Number(e.target.value) })} className="mt-1 w-full" />
              </label>
              <div className="flex gap-2">
                <button onClick={ed.bringForward} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-white/12 py-2 text-xs hover:bg-white/10"><ArrowUp size={13} /> Front</button>
                <button onClick={ed.deleteSelected} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-coral/30 bg-coral/10 py-2 text-xs text-peach hover:bg-coral/20"><Trash2 size={13} /> Delete</button>
              </div>
            </div>
          ) : (
            <p className="px-1 text-sm text-white/40">Click an element on the page to edit it.</p>
          )}
        </aside>
      </div>

      {/* filmstrip */}
      <div className="mt-4 flex items-center gap-3 overflow-x-auto rounded-2xl border border-white/10 bg-white/5 p-3">
        {ed.doc.spreads.map((s, i) => (
          <button key={s.id} onClick={() => ed.setActiveSpread(i)}
            className={`shrink-0 overflow-hidden rounded-md border-2 transition ${i === ed.activeSpread ? "border-coral" : "border-transparent opacity-70 hover:opacity-100"}`}>
            <SpreadRenderer spread={s} theme={s.theme || ed.doc.theme} scale={0.06} />
          </button>
        ))}
        <button onClick={ed.addSpread} className="grid h-16 w-24 shrink-0 place-items-center rounded-md border border-dashed border-white/20 text-white/50 hover:border-coral hover:text-white"><Plus size={18} /></button>
      </div>
    </div>
  );
}
