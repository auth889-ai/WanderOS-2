"use client";
import { useRef, type ChangeEvent } from "react";
import { Upload, Loader2, X, Image as ImageIcon, Film } from "lucide-react";

export type Media = { url: string; kind: "photo" | "video" };

export function MediaUploader({ media, uploading, postType, onFiles, onRemove }: {
  media: Media[]; uploading: boolean; postType: string; onFiles: (f: File[]) => void; onRemove: (i: number) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-[20px] border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
        {postType === "reel" ? <Film size={16} className="text-coral" /> : <ImageIcon size={16} className="text-coral" />}
        {media.length ? `${media.length} ${postType}` : "Add your media"}
      </div>
      <button onClick={() => ref.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-white/20 bg-white/5 p-9 text-white/55 transition hover:border-coral hover:text-white">
        {uploading ? <Loader2 className="animate-spin" /> : <Upload size={24} />}
        <span className="text-sm font-medium">{uploading ? "Uploading…" : "Click to add photos or a clip"}</span>
      </button>
      <input ref={ref} type="file" accept="image/*,video/*" multiple hidden onChange={(e: ChangeEvent<HTMLInputElement>) => { onFiles(Array.from(e.target.files ?? [])); if (ref.current) ref.current.value = ""; }} />
      {media.length > 0 && (
        <div className="mt-3 grid grid-cols-5 gap-2">
          {media.map((m, i) => (
            <div key={i} className="group relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.url} alt="" className="aspect-square w-full rounded-lg object-cover" />
              <button onClick={() => onRemove(i)} className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white opacity-0 group-hover:opacity-100"><X size={11} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
