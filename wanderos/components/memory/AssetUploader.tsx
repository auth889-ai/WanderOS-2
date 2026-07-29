"use client";

import { useRef, useState } from "react";

/**
 * Direct-to-B2 uploader for Autopilot trip assets (photos, clips, itinerary PDF).
 * Flow per file: POST /api/memory/[id]/presign → browser PUT to B2 → confirm key.
 * The app never proxies media bytes — B2 is the system of record from the first byte.
 */

export type UploadedAsset = { key: string; name: string; kind: "photo" | "clip" | "pdf" };

const KIND_BY_TYPE: Record<string, UploadedAsset["kind"]> = {
  "image/jpeg": "photo",
  "image/png": "photo",
  "image/webp": "photo",
  "video/mp4": "clip",
  "video/quicktime": "clip",
  "application/pdf": "pdf"
};

export function AssetUploader({
  jobId,
  assets,
  onChange,
  max = 60
}: {
  jobId: string;
  assets: UploadedAsset[];
  onChange: (next: UploadedAsset[]) => void;
  max?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState("");

  const assetsRef = useRef(assets);
  assetsRef.current = assets;

  async function uploadOne(file: File): Promise<UploadedAsset> {
    const contentType = file.type in KIND_BY_TYPE ? file.type : "";
    if (!contentType) throw new Error(`Unsupported file type: ${file.name}`);

    const presignRes = await fetch(`/api/memory/${jobId}/presign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, contentType })
    });
    if (!presignRes.ok) {
      const body = await presignRes.json().catch(() => ({}));
      throw new Error(body.message || body.error || `Presign failed (${presignRes.status})`);
    }
    const { key, url } = await presignRes.json();

    const putRes = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType }, body: file });
    if (!putRes.ok) throw new Error(`Upload to storage failed (${putRes.status})`);

    const confirmRes = await fetch(`/api/memory/${jobId}/assets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: [key] })
    });
    if (!confirmRes.ok) throw new Error("Upload confirmation failed");

    return { key, name: file.name, kind: KIND_BY_TYPE[contentType] };
  }

  async function addFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []).filter((f) => f.type in KIND_BY_TYPE);
    if (!files.length) return;
    const room = max - assetsRef.current.length;
    const batch = files.slice(0, Math.max(0, room));
    setError("");
    setUploading((n) => n + batch.length);
    for (const f of batch) {
      try {
        const uploaded = await uploadOne(f);
        onChange([...assetsRef.current, uploaded].slice(0, max));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  const photos = assets.filter((a) => a.kind === "photo").length;
  const clips = assets.filter((a) => a.kind === "clip").length;
  const pdfs = assets.filter((a) => a.kind === "pdf").length;

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
        className={`cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition ${
          dragging ? "border-aurora/40 bg-aurora/20" : "border-white/15 bg-white/5 hover:border-aurora/40"
        }`}
      >
        <p className="font-medium text-white/75">Drop your trip here — photos, clips, itinerary PDF</p>
        <p className="mt-1 text-sm text-white/45">
          The messier the better. The agent sorts it out. Up to {max} files.
        </p>
        {uploading > 0 && <p className="mt-2 text-sm text-aurora">Uploading {uploading} file(s) to secure storage…</p>}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,application/pdf"
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>

      {error && <p className="text-sm text-coral">{error}</p>}

      {assets.length > 0 && (
        <div className="flex items-center gap-4 text-sm text-white/60">
          <span className="rounded-full bg-white/5 px-3 py-1">{photos} photos</span>
          <span className="rounded-full bg-white/5 px-3 py-1">{clips} clips</span>
          {pdfs > 0 && <span className="rounded-full bg-white/5 px-3 py-1">{pdfs} itinerary</span>}
          <span className="ml-auto text-xs text-white/35">stored durably on Backblaze B2</span>
        </div>
      )}
    </div>
  );
}
