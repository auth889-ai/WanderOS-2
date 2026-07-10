/** Live exchange rate (open.er-api.com, free, no key). */
export async function getExchange(toCode?: string, from = "USD"): Promise<{ from: string; to: string; rate: number } | null> {
  if (!toCode) return null;
  try {
    const r = await fetch(`https://open.er-api.com/v6/latest/${from}`);
    const j = (await r.json().catch(() => ({}))) as { rates?: Record<string, number> };
    const rate = j.rates?.[toCode];
    return rate ? { from, to: toCode, rate } : null;
  } catch { return null; }
}
