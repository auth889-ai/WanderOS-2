import { randomUUID } from "crypto";
import { MemoryBuildInputSchema } from "./schemas";
import { SPREAD_TEMPLATES, PAGE_W, PAGE_H, type Slot } from "./templates";
import { curatePhotos } from "./agents/photo-curator/agent";
import { writeNarrative } from "./agents/narrative-writer/agent";
import { decorateSpreads } from "./agents/decorator/agent";
import type { Layer, Spread, MemoryBookDoc } from "@/lib/db/tables/memory-books";

type Progress = (pct: number, label: string) => void;

const MAX_SPREADS = 50; // ~100 pages

/** templates grouped by how many photo slots they have → lets us paginate + vary layouts. */
const BY_PHOTO_COUNT: Record<number, string[]> = {};
for (const [key, tpl] of Object.entries(SPREAD_TEMPLATES)) (BY_PHOTO_COUNT[tpl.photoSlots] ||= []).push(key);

const THEME_STICKER: Record<string, string> = { vintage: "🧭", "cherry-blossom": "🌸", "whimsical-dream": "✨", "sunset-coast": "🌅", "mono-minimal": "" };

function pickTemplate(count: number, preferQuote: boolean, salt: number): string {
  if (preferQuote) return "full-bleed-quote";
  const want = count <= 1 ? 1 : count === 2 ? 2 : count === 3 ? 3 : 4;
  const pool = BY_PHOTO_COUNT[want] ?? BY_PHOTO_COUNT[4] ?? ["journal-2col"];
  return pool[salt % pool.length];
}
const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);

/**
 * Memory-book crew: curate → narrate → (deterministic) paginate every photo into spreads → decorate.
 * Pagination guarantees NO photo is cut — a chapter's photos overflow into extra spreads (up to ~100 pages).
 */
export async function runMemoryBuild(input: unknown, onProgress?: Progress): Promise<MemoryBookDoc> {
  const data = MemoryBuildInputSchema.parse(input);
  const photos = data.photos;
  if (!photos.length) throw new Error("No photos to build a memory book.");

  // ① curate -----------------------------------------------------------------
  onProgress?.(15, "Curating your photos…");
  const { chapters: curated } = await curatePhotos({
    photos: photos.map((p, i) => ({ index: i, description: p.description ?? "a travel photo", location: p.location, date: p.date }))
  });
  const chapters = curated
    .map((c) => ({ ...c, photoIndexes: c.photoIndexes.filter((idx) => idx >= 0 && idx < photos.length) }))
    .filter((c) => c.photoIndexes.length > 0);

  // safety net: any photo the curator missed gets its own chapter — NOTHING is cut.
  const placed = new Set(chapters.flatMap((c) => c.photoIndexes));
  const missed = photos.map((_, i) => i).filter((i) => !placed.has(i));
  if (missed.length) chapters.push({ title: "More moments", place: undefined, vibe: "joyful", photoIndexes: missed });
  if (!chapters.length) throw new Error("Curator produced no usable chapters.");

  // ② narrate ----------------------------------------------------------------
  onProgress?.(45, "Writing your story…");
  const narrative = await writeNarrative({
    title: data.title, tripContext: data.tripContext, userText: data.userText,
    chapters: chapters.map((c) => ({ title: c.title, vibe: c.vibe, photos: c.photoIndexes.map((idx) => ({ index: idx, description: photos[idx].description ?? "" })) }))
  });
  const planned = chapters.map((c, i) => {
    const nc = narrative.chapters[i] ?? { title: c.title, story: "", captions: [] as { photoIndex: number; caption: string }[], quote: undefined };
    return { title: nc.title, story: nc.story, quote: nc.quote, captions: nc.captions, photoIndexes: c.photoIndexes, vibe: c.vibe };
  });

  // ③ paginate (deterministic composer — every photo placed) -----------------
  onProgress?.(70, "Designing the pages…");
  const theme = narrative.theme;
  const spreads: Spread[] = [];
  let salt = 0;

  const captionFor = (p: (typeof planned)[number], idx: number) => p.captions.find((c) => c.photoIndex === idx)?.caption ?? "";

  function buildSpread(key: string, photoIdxs: number[], p: (typeof planned)[number], opts: { bookTitle?: boolean; chapterTitle: boolean; story: boolean; quote: boolean }): Spread {
    const tpl = SPREAD_TEMPLATES[key] ?? SPREAD_TEMPLATES["journal-2col"];
    let photoPtr = 0, capPtr = 0;
    const fill = (slots: Slot[]): Layer[] => {
      const out: Layer[] = [];
      for (const s of slots) {
        const base = { id: randomUUID(), x: s.x, y: s.y, w: s.w, h: s.h, rotation: s.rotation ?? 0, role: s.role, variant: s.variant };
        if (s.kind === "photo") {
          if (photoPtr >= photoIdxs.length) continue;
          const idx = photoIdxs[photoPtr++];
          out.push({ ...base, kind: "photo", src: photos[idx].url, source: photos[idx].source });
          // per-photo caption — like travelmate, every photo gets its own detail line
          const cap = captionFor(p, idx);
          if (cap) {
            if (s.variant === "polaroid") out.push({ id: randomUUID(), kind: "text", role: "photo-caption", variant: "polaroid", x: s.x + 8, y: s.y + s.h - 44, w: s.w - 16, h: 40, rotation: s.rotation ?? 0, text: cap });
            else if (s.variant !== "full-bleed") out.push({ id: randomUUID(), kind: "text", role: "photo-caption", x: s.x, y: Math.min(s.y + s.h + 4, PAGE_H - 46), w: s.w, h: 42, rotation: s.rotation ?? 0, text: cap });
          }
        } else {
          let text = "";
          if (s.role === "title") text = opts.bookTitle ? narrative.bookTitle : opts.chapterTitle ? p.title : "";
          else if (s.role === "story") text = opts.story ? p.story : "";
          else if (s.role === "quote") text = opts.quote ? p.quote ?? "" : "";
          else if (s.role === "date") text = photos[photoIdxs[0]]?.date ?? "";
          else if (s.role === "caption") { capPtr++; continue; } // captions now live under each photo
          if (!text) continue; // skip empty text boxes (e.g. continuation spreads)
          out.push({ ...base, kind: "text", text });
        }
      }
      return out;
    };
    return { id: randomUUID(), layout: key, theme, leftPage: { layers: fill(tpl.left) }, rightPage: { layers: fill(tpl.right) } };
  }

  for (let i = 0; i < planned.length && spreads.length < MAX_SPREADS; i++) {
    const p = planned[i];
    const idxs = [...p.photoIndexes];
    let firstOfChapter = true;
    if (i === 0 && idxs.length) {
      const hero = idxs.shift()!;
      spreads.push(buildSpread("title-page", [hero], p, { bookTitle: true, chapterTitle: false, story: true, quote: false }));
      firstOfChapter = false;
    }
    while (idxs.length && spreads.length < MAX_SPREADS) {
      const size = Math.min(idxs.length, 4);
      const chunk = idxs.splice(0, size);
      const preferQuote = firstOfChapter && !!p.quote && size === 1;
      // chapter openers with 2 photos use the "Sky-High Dreams" feature-journal layout
      const key = firstOfChapter && size === 2 ? "feature-journal" : pickTemplate(size, preferQuote, salt++);
      spreads.push(buildSpread(key, chunk, p, { chapterTitle: firstOfChapter, story: firstOfChapter, quote: firstOfChapter && !!p.quote }));
      firstOfChapter = false;
    }
  }

  // ④ decorate — deterministic theme sticker on every spread + best-effort AI flourishes ----
  onProgress?.(85, "Adding finishing touches…");
  const themeSticker = THEME_STICKER[theme];
  if (themeSticker) {
    spreads.forEach((s) => s.rightPage.layers.push({ id: randomUUID(), kind: "sticker", variant: "theme", x: PAGE_W - 110, y: 60, w: 80, h: 80, rotation: 8, text: themeSticker }));
  }
  try {
    const deco = await decorateSpreads({ theme, spreads: spreads.slice(0, 16).map((_, i) => ({ index: i, vibe: planned[Math.min(i, planned.length - 1)]?.vibe ?? "joyful" })) });
    for (const ds of deco.spreads) {
      const spread = spreads[ds.spreadIndex];
      if (!spread) continue;
      for (const d of ds.decorations) {
        (d.side === "left" ? spread.leftPage : spread.rightPage).layers.push({
          id: randomUUID(), kind: d.emoji ? "sticker" : "decoration", variant: d.variant,
          x: Math.round(clamp01(d.xRatio) * PAGE_W), y: Math.round(clamp01(d.yRatio) * PAGE_H), w: 90, h: 90, rotation: d.rotation ?? 0, text: d.emoji
        });
      }
    }
  } catch { /* decorations optional */ }

  onProgress?.(100, "Your memory book is ready");
  return { title: narrative.bookTitle, theme, spreads };
}
