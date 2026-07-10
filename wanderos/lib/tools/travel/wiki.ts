/** Wikipedia REST summary (free, no key) — a rich destination overview + image. */
export async function getWikiSummary(title: string): Promise<{ extract: string; thumbnail: string | null } | null> {
  if (!title) return null;
  try {
    const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { headers: { "User-Agent": "WanderOS/1.0" } });
    if (!r.ok) return null;
    const j = (await r.json().catch(() => ({}))) as { extract?: string; thumbnail?: { source?: string } };
    return j.extract ? { extract: j.extract, thumbnail: j.thumbnail?.source ?? null } : null;
  } catch { return null; }
}
