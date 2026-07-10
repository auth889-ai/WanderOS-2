"use client";
import { BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { Media } from "./MediaUploader";
export function ComposeReview({ media, caption, onCaption, tags, busy, onPublish, onBack }: {
  media: Media[]; caption: string; onCaption: (v: string) => void; tags: string[]; busy: boolean; onPublish: () => void; onBack: () => void;
}) {
  return (
    <div className="mt-6 space-y-4 rounded-[20px] border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl">
      <p className="text-xs uppercase tracking-[0.2em] text-mist">AI draft — review &amp; publish</p>
      <div className="grid grid-cols-3 gap-2">
        {media.map((m, i) => m.kind === "video"
          ? <video key={i} src={m.url} className="aspect-square w-full rounded-xl object-cover" />
          : <img key={i} src={m.url} alt="" className="aspect-square w-full rounded-xl object-cover" />)}
      </div>
      <textarea className="min-h-28 w-full rounded-xl border border-white/12 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-coral" value={caption} onChange={(e) => onCaption(e.target.value)} />
      {tags.length > 0 && <p className="flex flex-wrap gap-2 text-sm text-mist">{tags.map((t) => <span key={t}>#{t.replace(/^#/, "")}</span>)}</p>}
      <div className="flex gap-3">
        <Button onClick={onPublish} disabled={busy} className="inline-flex items-center gap-2"><BadgeCheck size={16} /> {busy ? "Publishing…" : "Publish to feed"}</Button>
        <button onClick={onBack} className="rounded-2xl border border-white/12 bg-white/5 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10">Back</button>
      </div>
    </div>
  );
}
