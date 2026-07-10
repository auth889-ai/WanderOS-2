/** Open-Meteo — REAL 7-day forecast, no API key required. */
export type WeatherOutlook = { minTemp: number; maxTemp: number; rainDays: number; summary: string };
export async function getWeather(lat: number, lng: number): Promise<WeatherOutlook | null> {
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&forecast_days=7&timezone=auto`);
    const j = (await r.json().catch(() => ({}))) as { daily?: { temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_sum: number[] } };
    const d = j.daily; if (!d?.temperature_2m_max?.length) return null;
    const maxTemp = Math.round(Math.max(...d.temperature_2m_max));
    const minTemp = Math.round(Math.min(...d.temperature_2m_min));
    const rainDays = d.precipitation_sum.filter((x) => x > 1).length;
    return { minTemp, maxTemp, rainDays, summary: `${minTemp}–${maxTemp}°C, rain ${rainDays}/7 days` };
  } catch { return null; }
}
