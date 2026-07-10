/** Unsplash — a premium destination hero image. */
const UN = process.env.UNSPLASH_ACCESS_KEY;
export async function getHeroImage(query: string): Promise<string | null> {
  if (!UN || !query) return null;
  try {
    const r = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query + " travel landscape")}&per_page=1&orientation=landscape&client_id=${UN}`);
    const j = (await r.json().catch(() => ({}))) as { results?: { urls?: { regular?: string } }[] };
    return j.results?.[0]?.urls?.regular ?? null;
  } catch { return null; }
}
