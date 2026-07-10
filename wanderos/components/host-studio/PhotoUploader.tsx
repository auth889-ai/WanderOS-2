"use client";

import { useRef, useState } from "react";
import { uploadPhoto } from "@/lib/api/host-listings";

/**
 * Drag-and-drop dropzone that uploads each image to Cloudinary and stores the returned URL.
 * URLs (not heavy base64) keep listing payloads tiny and let the vision crew fetch photos by URL.
 */
export function PhotoUploader({ photos, onChange, max = 30 }: { photos: string[]; onChange: (next: string[]) => void; max?: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0); // count in flight
  const [error, setError] = useState("");

  async function addFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    const room = max - photos.length;
    const batch = files.slice(0, Math.max(0, room));
    setError("");
    setUploading((n) => n + batch.length);
    for (const f of batch) {
      try {
        const url = await uploadPhoto(f);
        onChange([...photosRef.current, url].slice(0, max));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  // keep a live ref so concurrent uploads append correctly
  const photosRef = useRef(photos);
  photosRef.current = photos;

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-2xl border border-dashed p-7 text-center transition ${
          dragging ? "border-coral bg-coral/10" : "border-white/15 bg-black/20 hover:bg-white/5"
        }`}
      >
        <input ref={inputRef} type="file" multiple accept="image/*" className="hidden" onChange={(e) => addFiles(e.target.files)} />
        <div className="text-lg font-semibold text-white">{uploading > 0 ? `Uploading ${uploading} photo${uploading > 1 ? "s" : ""}…` : "Drag & drop photos here"}</div>
        <p className="mt-2 text-sm text-white/60">or click to select multiple images</p>
        <p className="mt-2 text-xs text-white/40">Uploaded to Cloudinary, then analyzed by the AI — your real photos, never fabricated.</p>
      </div>

      {error && <p className="rounded-xl border border-coral/40 bg-coral/10 px-4 py-2 text-sm text-peach">{error}</p>}

      {photos.length > 0 && (
        <>
          <p className="text-sm text-white/60">Uploaded photos: {photos.length}{uploading > 0 ? ` (+${uploading} uploading)` : ""}</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {photos.map((src, i) => (
              <div key={src} className="group relative overflow-hidden rounded-2xl border border-white/10">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="h-32 w-full object-cover" />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(photos.filter((_, j) => j !== i));
                  }}
                  className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-1 text-xs text-white opacity-0 transition group-hover:opacity-100"
                >
                  Remove
                </button>
                {i === 0 && <div className="absolute left-2 top-2 rounded-full bg-gradient-to-r from-coral to-mist px-2 py-1 text-xs font-medium text-night">Cover</div>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
