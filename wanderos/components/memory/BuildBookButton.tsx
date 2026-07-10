"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2 } from "lucide-react";

/** Creates a book + enqueues the build, then navigates to the (building) book page. */
export function BuildBookButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function build() {
    setBusy(true);
    const r = await fetch("/api/memory-books", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const j = (await r.json().catch(() => ({}))) as { bookId?: string };
    if (r.ok && j.bookId) router.push(`/memory-books/${j.bookId}`);
    else setBusy(false);
  }

  return (
    <button onClick={build} disabled={busy} className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-coral to-mist px-5 py-3 text-sm font-semibold text-night shadow-[0_8px_24px_rgba(239,109,91,0.35)] transition hover:-translate-y-0.5 disabled:opacity-60">
      {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Build my memory book
    </button>
  );
}
