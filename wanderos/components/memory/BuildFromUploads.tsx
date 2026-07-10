"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2, Sparkles, X, ImagePlus } from "lucide-react";
import { uploadPostMedia } from "@/lib/api/posts-client";

/** Build a memory book directly from manually uploaded photos (no posts needed). */
export function BuildFromUploads() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [urls, setUrls] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [building, setBuilding] = useState(false);

  async function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    for (const f of files) { const u = await uploadPostMedia(f); if (u) setUrls((x) => [...x, u]); }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function build() {
    if (!urls.length) return;
    setBuilding(true);
    const r = await fetch("/api/memory-books", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title || undefined, photos: urls.map((u) => ({ url: u })) })
    });
    const j = (await r.json().catch(() => ({}))) as { bookId?: string };
    if (r.ok && j.bookId) router.push(`/memory-books/${j.bookId}`);
    else setBuilding(false);
  }

  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
        <ImagePlus size={16} /> Build from uploads
      </button>
    );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur" onClick={() => !building && setOpen(false)}>
      <div className="w-full max-w-lg rounded-2xl border border-white/12 bg-[#1c1426] p-6 text-white" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Build from your photos</h2>
          <button onClick={() => setOpen(false)} className="text-white/50 hover:text-white"><X size={18} /></button>
        </div>

        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Book title (optional)"
          className="mb-3 w-full rounded-xl border border-white/12 bg-white/5 px-3 py-2.5 text-sm outline-none focus:border-coral" />

        <button onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-white/20 bg-white/5 p-8 text-white/60 transition hover:border-coral hover:text-white">
          {uploading ? <Loader2 className="animate-spin" /> : <Upload size={24} />}
          <span className="text-sm font-medium">{uploading ? "Uploading…" : "Click to add photos"}</span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFiles} />

        {urls.length > 0 && (
          <div className="mt-3 grid grid-cols-6 gap-2">
            {urls.map((u, i) => (
              <div key={i} className="group relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="" className="aspect-square w-full rounded-lg object-cover" />
                <button onClick={() => setUrls((x) => x.filter((_, j) => j !== i))} className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-black/70 opacity-0 group-hover:opacity-100"><X size={11} /></button>
              </div>
            ))}
          </div>
        )}

        <button onClick={build} disabled={building || !urls.length}
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-coral to-mist px-5 py-3 text-sm font-semibold text-night disabled:opacity-50">
          {building ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} {building ? "Building…" : `Build book from ${urls.length || ""} photos`}
        </button>
      </div>
    </div>
  );
}
