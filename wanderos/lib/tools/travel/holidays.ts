/** Calendarific — REAL public/cultural holidays. Cultural holidays (Eid, Puja…) ARE the local festivals. */
const KEY = process.env.CALENDARIFIC_API_KEY;

export type HolidayHit = {
  name: string; date: string; types: string[]; description?: string;
  daysLeft: number; longWeekend: boolean;
};

export async function getUpcomingHolidays(country: string, fromISO = new Date().toISOString().slice(0, 10)): Promise<HolidayHit[]> {
  if (!KEY || !country) return [];
  const year = new Date(fromISO).getFullYear();
  const out: HolidayHit[] = [];
  for (const y of [year, year + 1]) {
    try {
      const r = await fetch(`https://calendarific.com/api/v2/holidays?api_key=${KEY}&country=${country}&year=${y}`);
      const j = (await r.json().catch(() => ({}))) as { response?: { holidays?: { name: string; date?: { iso?: string }; type?: string[]; description?: string }[] } };
      for (const h of j.response?.holidays ?? []) {
        const iso = h.date?.iso?.slice(0, 10);
        if (!iso || iso < fromISO) continue;
        const daysLeft = Math.round((new Date(iso).getTime() - new Date(fromISO).getTime()) / 86400000);
        if (daysLeft > 150) continue;
        const dow = new Date(iso).getDay(); // Fri/Sat weekend (BD): a holiday on Thu/Sun/Fri/Sat extends it
        out.push({ name: h.name, date: iso, types: h.type ?? [], description: h.description, daysLeft, longWeekend: [4, 5, 6, 0].includes(dow) });
      }
    } catch { /* skip year */ }
  }
  // de-dupe by name+date, soonest first
  const seen = new Set<string>();
  return out.filter((h) => { const k = h.name + h.date; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 8);
}
