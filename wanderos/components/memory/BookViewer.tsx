"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Pencil, Loader2, BookOpen, Download } from "lucide-react";
import type { MemoryBookRow } from "@/lib/memory/types";

const FlipBook = dynamic(() => import("./FlipBook").then((m) => m.FlipBook), {
  ssr: false,
  loading: () => <div className="grid h-[680px] place-items-center text-white/40"><Loader2 className="animate-spin" /></div>
});

/** Viewer — live SSE build progress, then a real flippable book (drag a corner to turn). */
export function BookViewer({ initial }: { initial: MemoryBookRow }) {
  const [book, setBook] = useState(initial);
  const [status, setStatus] = useState(initial.status);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("Starting…");

  useEffect(() => {
    if (initial.status !== "building") return;
    const es = new EventSource(`/api/memory-books/${initial.id}/stream`);
    es.onmessage = async (ev) => {
      try {
        const d = JSON.parse(ev.data) as { status?: string; progress?: number; stage?: string; done?: boolean };
        if (typeof d.progress === "number") setProgress(d.progress);
        if (d.stage) setStage(d.stage);
        if (d.status) setStatus(d.status as MemoryBookRow["status"]);
        if (d.status === "ready") {
          es.close();
          const r = await fetch(`/api/memory-books/${initial.id}`, { cache: "no-store" });
          const j = (await r.json().catch(() => ({}))) as { book?: MemoryBookRow };
          if (j.book) setBook(j.book);
        }
        if (d.status === "failed" || d.done) es.close();
      } catch { /* keep */ }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [initial.id, initial.status]);

  if (status === "building") {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/5 py-16 text-center backdrop-blur-xl">
        <Loader2 className="animate-spin text-coral" size={30} />
        <p className="text-lg font-semibold text-white">Designing your memory book…</p>
        <p className="text-sm text-white/55">{stage}</p>
        <div className="h-1.5 w-64 overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-gradient-to-r from-coral to-mist transition-all" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-xs text-white/40">curate → write → design → decorate</p>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-coral/30 bg-coral/10 p-8 text-center text-white">
        <p className="font-semibold">We couldn’t build this book.</p>
        <p className="mt-1 text-sm text-white/60">Make sure you’ve shared some travel posts with photos, then try again.</p>
        <Link href="/memory-books" className="mt-4 inline-block text-sm font-semibold text-coral">← Back to your books</Link>
      </div>
    );
  }

  const spreads = book.doc?.spreads ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-mist"><BookOpen size={13} /> Memory Book</p>
          <h1 className="mt-1 text-3xl font-bold text-white">{book.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/memory-books/${book.id}/print`} className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10">
            <Download size={15} /> PDF
          </Link>
          <Link href={`/memory-books/${book.id}/edit`} className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-coral to-mist px-4 py-2.5 text-sm font-semibold text-night shadow-[0_8px_24px_rgba(239,109,91,0.35)] transition hover:-translate-y-0.5">
            <Pencil size={15} /> Edit
          </Link>
        </div>
      </div>

      {spreads.length ? (
        <div className="flex flex-col items-center gap-4">
          <div className="book-stage">
            <FlipBook doc={book.doc} width={460} />
          </div>
          <p className="text-xs text-white/40">📖 Drag a page corner to flip · {spreads.length} spreads</p>
        </div>
      ) : (
        <p className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center text-white/55">This book has no spreads yet.</p>
      )}
    </div>
  );
}
