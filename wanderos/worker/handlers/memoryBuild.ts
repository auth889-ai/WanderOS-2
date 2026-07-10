import { JobHandler } from "@/lib/queue/runner";
import { queryAurora } from "@/lib/db/pool";
import { runMemoryBuild } from "@/lib/agents/crews/memory-book";
import { describeUploads } from "@/lib/agents/crews/memory-book/describe";
import type { MemorySource } from "@/lib/agents/crews/memory-book/schemas";
import * as books from "@/lib/db/tables/memory-books";

type MemoryBuildInput = { bookId?: string; travelerId?: string; tripId?: string | null; title?: string | null; photos?: { url: string; description?: string }[] | null };

type PhotoRow = { media_url: string; ai_description: string | null; caption: string | null; location: string | null; created_at: string };

/** memory_build job — source photos from manual uploads (if provided) or the traveler's posts → design crew → persist. */
export const memoryBuildHandler: JobHandler = async (ctx) => {
  const input = ctx.input as MemoryBuildInput;
  if (!input.bookId || !input.travelerId) throw new Error("memory_build requires bookId and travelerId.");

  try {
    await ctx.reportProgress(6, "Gathering your travel photos");
    await ctx.throwIfCancelled();

    let photos: MemorySource[];
    if (input.photos && input.photos.length) {
      // manually uploaded photos → vision-describe the ones without a description so the crew stays grounded
      await ctx.reportProgress(10, "Looking at your photos");
      photos = await describeUploads(input.photos.map((p) => ({ url: p.url, description: p.description, source: "upload" as const })));
    } else {
      const rows = await queryAurora<PhotoRow>(
        `select pm.media_url, pm.ai_description, p.caption, p.location, p.created_at
           from post_media pm
           join travel_posts p on p.id = pm.post_id
          where p.author_id = $1 and p.status in ('published', 'draft') and pm.media_kind = 'photo'
          order by p.created_at asc
          limit 120`,
        [input.travelerId]
      );
      if (!rows.length) throw new Error("No photos found — share some travel posts or upload photos, then build your book.");
      photos = rows.map((r) => ({
        url: r.media_url,
        description: r.ai_description || r.caption || "a travel moment",
        location: r.location ?? undefined,
        date: r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : undefined,
        source: "post" as const
      }));
    }

    const doc = await runMemoryBuild(
      { bookId: input.bookId, travelerId: input.travelerId, tripId: input.tripId ?? null, title: input.title ?? undefined, photos },
      async (pct, label) => { await ctx.reportProgress(pct, label); await ctx.throwIfCancelled(); }
    );

    await books.updateDoc(input.bookId, doc);
    await books.saveVersion(input.bookId, doc);
    const cover = doc.spreads
      .flatMap((s) => [...s.leftPage.layers, ...s.rightPage.layers])
      .find((l) => l.kind === "photo" && l.src)?.src;
    if (cover) await books.setCover(input.bookId, cover, doc.theme);
    await books.setStatus(input.bookId, "ready");

    return { bookId: input.bookId, spreads: doc.spreads.length, status: "ready" };
  } catch (error) {
    await books.setStatus(input.bookId, "failed").catch(() => {});
    throw error;
  }
};
