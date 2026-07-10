"use client";

import { useState } from "react";

/** Airbnb-style photo collage (1 big + 4 small) with a "Show all N photos" overlay showing EVERY upload. */
export function PhotoGallery({ photos, title }: { photos: string[]; title: string }) {
  const [open, setOpen] = useState(false);
  if (photos.length === 0) return null;
  const collage = photos.slice(0, 5);

  return (
    <>
      <div className="relative grid grid-cols-4 grid-rows-2 gap-2 overflow-hidden rounded-[24px]">
        {/* eslint-disable @next/next/no-img-element */}
        <img src={collage[0]} alt={title} className="col-span-2 row-span-2 h-full max-h-[460px] w-full object-cover" />
        {collage.slice(1, 5).map((p, i) => (
          <img key={i} src={p} alt="" className="h-full max-h-[228px] w-full object-cover" />
        ))}
        {/* eslint-enable @next/next/no-img-element */}
        {photos.length > 1 && (
          <button
            onClick={() => setOpen(true)}
            className="absolute bottom-4 right-4 rounded-xl border border-white/30 bg-black/60 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition hover:bg-black/80"
          >
            Show all {photos.length} photos
          </button>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-night/95 backdrop-blur-xl">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-night/80 px-6 py-4">
            <p className="text-lg font-semibold text-white">{title} — {photos.length} photos</p>
            <button onClick={() => setOpen(false)} className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20">
              ✕ Close
            </button>
          </div>
          <div className="mx-auto grid max-w-4xl gap-3 p-6 sm:grid-cols-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {photos.map((p, i) => <img key={i} src={p} alt="" className="w-full rounded-2xl border border-white/10 object-cover" />)}
          </div>
        </div>
      )}
    </>
  );
}
