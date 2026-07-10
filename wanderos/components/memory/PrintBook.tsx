"use client";

import { Printer, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { SpreadRenderer } from "./SpreadRenderer";
import type { MemoryBookRow } from "@/lib/memory/types";

/** Print-optimized layout — every spread on its own page; "Save as PDF" via the browser print dialog. */
export function PrintBook({ book }: { book: MemoryBookRow }) {
  const spreads = book.doc?.spreads ?? [];
  return (
    <div className="min-h-screen bg-[#1a1320] py-8">
      <div className="no-print mx-auto mb-6 flex max-w-5xl items-center justify-between px-4">
        <Link href={`/memory-books/${book.id}`} className="inline-flex items-center gap-2 text-sm font-semibold text-white/70 hover:text-white"><ArrowLeft size={16} /> Back</Link>
        <h1 className="text-lg font-semibold text-white">{book.title}</h1>
        <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-coral to-mist px-4 py-2.5 text-sm font-semibold text-night"><Printer size={15} /> Save as PDF</button>
      </div>

      <div className="print-book mx-auto flex max-w-5xl flex-col items-center gap-8 px-4 print:gap-0">
        {spreads.map((s) => (
          <div key={s.id} className="print-spread">
            <SpreadRenderer spread={s} theme={s.theme || book.doc.theme} scale={0.62} />
          </div>
        ))}
      </div>
    </div>
  );
}
