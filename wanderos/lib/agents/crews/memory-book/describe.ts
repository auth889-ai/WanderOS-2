import { describePhotoBatch } from "./agents/photo-describer/agent";
import type { MemorySource } from "./schemas";

/** Fill in missing descriptions for uploaded photos via batched vision (groups of 6). Best-effort. */
export async function describeUploads(photos: MemorySource[]): Promise<MemorySource[]> {
  const out = photos.map((p) => ({ ...p }));
  const missing = out.map((p, i) => ({ p, i })).filter(({ p }) => !p.description || p.description.length < 8);
  for (let g = 0; g < missing.length; g += 6) {
    const batch = missing.slice(g, g + 6);
    try {
      const res = await describePhotoBatch({ urls: batch.map((b) => b.p.url) });
      for (const d of res.descriptions) {
        const target = batch[d.index];
        if (target) out[target.i].description = d.description;
      }
    } catch { /* keep generic description */ }
  }
  return out;
}
