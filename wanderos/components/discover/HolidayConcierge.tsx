"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarHeart, Loader2, Sparkles, MapPin, Star, CheckCircle2, PartyPopper, Lightbulb } from "lucide-react";

type Dest = { name: string; why: string; photoUrl?: string; rating?: number };
type Plan = { holiday: string; date: string; daysLeft: number; longWeekend: boolean; overview: string; whatToDo: string[]; traditions: string[]; bestDestinations: Dest[]; travelTip: string };
type Holiday = { name: string; date: string; daysLeft: number; longWeekend: boolean };

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" });

const COUNTRIES: [string, string][] = [
  ["BD", "🇧🇩 Bangladesh"], ["IN", "🇮🇳 India"], ["PK", "🇵🇰 Pakistan"], ["LK", "🇱🇰 Sri Lanka"], ["NP", "🇳🇵 Nepal"],
  ["BT", "🇧🇹 Bhutan"], ["MV", "🇲🇻 Maldives"], ["TH", "🇹🇭 Thailand"], ["MY", "🇲🇾 Malaysia"], ["ID", "🇮🇩 Indonesia"],
  ["SG", "🇸🇬 Singapore"], ["JP", "🇯🇵 Japan"], ["AE", "🇦🇪 UAE"], ["TR", "🇹🇷 Turkey"], ["GB", "🇬🇧 UK"],
  ["FR", "🇫🇷 France"], ["IT", "🇮🇹 Italy"], ["ES", "🇪🇸 Spain"], ["US", "🇺🇸 USA"], ["AU", "🇦🇺 Australia"]
];

export function HolidayConcierge() {
  const [country, setCountry] = useState("BD");
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [planning, setPlanning] = useState(false);

  function load(c: string) {
    setLoading(true); setPlan(null);
    fetch(`/api/travel-intel/holidays?country=${c}`).then((r) => r.json()).then((j: { holidays?: Holiday[]; plan?: Plan | null }) => {
      setHolidays(j.holidays || []); setPlan(j.plan || null); setLoading(false);
    }).catch(() => setLoading(false));
  }
  useEffect(() => { load("BD"); }, []);

  async function pick(h: Holiday) {
    if (plan?.holiday === h.name) return;
    setPlanning(true);
    const r = await fetch("/api/travel-intel/holidays", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ country, holiday: h.name, date: h.date, daysLeft: h.daysLeft, longWeekend: h.longWeekend }) });
    const j = (await r.json().catch(() => ({}))) as { plan?: Plan };
    if (j.plan) setPlan(j.plan);
    setPlanning(false);
  }

  if (loading) {
    return <div className="mx-auto mb-5 max-w-4xl rounded-[28px] bg-gradient-to-b from-[#fdf8f3] to-[#f6ebdd] p-7 shadow-[0_24px_70px_rgba(15,9,20,0.5)]"><div className="flex items-center gap-3 text-[#8a7e76]"><Loader2 className="animate-spin text-[#ef6d5b]" /> Finding your upcoming holidays…</div></div>;
  }
  const topDest = plan?.bestDestinations[0]?.name;

  return (
    <div className="mx-auto mb-5 max-w-4xl rounded-[28px] bg-gradient-to-b from-[#fdf8f3] to-[#f6ebdd] p-5 shadow-[0_24px_70px_rgba(15,9,20,0.5)] sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-[#ef6d5b]"><CalendarHeart size={14} /> Holiday Concierge</div>
          <h1 className="text-3xl font-bold text-[#312b27]">Make the most of your time off</h1>
          <p className="mt-1 text-sm text-[#8a7e76]">Your upcoming holidays — tap one to see what you can do, where to go, and plan it in a tap.</p>
        </div>
        <select value={country} onChange={(e) => { setCountry(e.target.value); load(e.target.value); }} className="rounded-xl border border-[#f0e6dc] bg-white px-3 py-2 text-sm font-medium text-[#312b27] outline-none focus:border-[#ef6d5b]">
          {COUNTRIES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select>
      </div>

      {!holidays.length && <p className="mt-4 text-sm text-[#8a7e76]">No upcoming public holidays found for this country in the next few months — try another country.</p>}

      {/* holiday chips */}
      <div className="mt-4 flex flex-wrap gap-2">
        {holidays.slice(0, 8).map((h, i) => (
          <button key={i} onClick={() => pick(h)} className={`rounded-full px-3 py-2 text-xs font-medium transition ${plan?.holiday === h.name ? "bg-[#ef6d5b] text-white shadow-[0_6px_16px_rgba(239,109,91,0.35)]" : "border border-[#f0e6dc] bg-white text-[#4a423b] hover:border-[#ef6d5b]"}`}>
            {h.name} · <b>{h.daysLeft}d</b>{h.longWeekend ? " 🎉" : ""}
          </button>
        ))}
      </div>

      {planning && <div className="mt-4 flex items-center gap-2 text-sm text-[#8a7e76]"><Loader2 size={15} className="animate-spin text-[#ef6d5b]" /> Building your holiday plan…</div>}

      {plan && !planning && (
        <div className="mt-5 space-y-4">
          {/* holiday header */}
          <div className="rounded-2xl border-2 border-[#ef6d5b] bg-white p-5 shadow-[0_10px_30px_rgba(239,109,91,0.12)]">
            <p className="text-2xl font-bold text-[#312b27]">{plan.holiday}</p>
            <p className="text-sm text-[#ef6d5b]">{fmt(plan.date)} · in {plan.daysLeft} days{plan.longWeekend ? " · long weekend 🎉" : ""}</p>
            <p className="mt-2 text-[15px] leading-relaxed text-[#4a423b]">{plan.overview}</p>
            {topDest && (
              <Link href={`/trips/new?destination=${encodeURIComponent(topDest)}`} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#ef6d5b] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(239,109,91,0.35)] transition hover:-translate-y-0.5">
                <Sparkles size={15} /> Plan my {plan.holiday} trip → {topDest}
              </Link>
            )}
          </div>

          {/* what to do + traditions */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-[#f0e6dc] bg-white p-5">
              <p className="mb-3 flex items-center gap-2 font-semibold text-[#312b27]"><span className="grid h-7 w-7 place-items-center rounded-lg bg-[#fce8e3] text-[#ef6d5b]"><CheckCircle2 size={15} /></span>What you can do</p>
              <ul className="space-y-2">
                {plan.whatToDo.map((w, i) => <li key={i} className="flex gap-2 text-sm text-[#4a423b]"><span className="text-[#ef6d5b]">›</span>{w}</li>)}
              </ul>
            </div>
            <div className="rounded-2xl border border-[#f0e6dc] bg-white p-5">
              <p className="mb-3 flex items-center gap-2 font-semibold text-[#312b27]"><span className="grid h-7 w-7 place-items-center rounded-lg bg-[#fbecd6] text-[#d8932f]"><PartyPopper size={15} /></span>Traditions &amp; festive food</p>
              <ul className="space-y-2">
                {plan.traditions.map((t, i) => <li key={i} className="flex gap-2 text-sm text-[#4a423b]"><span className="text-[#d8932f]">›</span>{t}</li>)}
              </ul>
            </div>
          </div>

          {/* best destinations */}
          <div className="rounded-2xl border border-[#f0e6dc] bg-white p-5">
            <p className="mb-3 flex items-center gap-2 font-semibold text-[#312b27]"><span className="grid h-7 w-7 place-items-center rounded-lg bg-[#fce8e3] text-[#ef6d5b]"><MapPin size={15} /></span>Where to go for {plan.holiday}</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {plan.bestDestinations.map((d, i) => (
                <Link key={i} href={`/trips/new?destination=${encodeURIComponent(d.name)}`} className="group block overflow-hidden rounded-xl border border-[#f0e6dc] bg-[#fdf8f3] transition hover:-translate-y-1 hover:border-[#ef6d5b]">
                  {d.photoUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={d.photoUrl} alt="" className="h-32 w-full object-cover transition group-hover:scale-105" />
                    : <div className="grid h-32 place-items-center text-[#cbb8a6]"><MapPin /></div>}
                  <div className="p-3">
                    <p className="flex items-start justify-between gap-2 text-sm font-semibold text-[#312b27]">{d.name}{d.rating ? <span className="flex shrink-0 items-center gap-1 text-xs text-amber-500"><Star size={11} fill="currentColor" />{d.rating}</span> : null}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-[#8a7e76]">{d.why}</p>
                    <p className="mt-1 text-[11px] font-semibold text-[#ef6d5b]">Plan a trip here →</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* tip */}
          <p className="flex items-start gap-2 rounded-2xl bg-[#fbecd6] px-4 py-3 text-sm text-[#8a6a36]"><Lightbulb size={16} className="mt-0.5 shrink-0" /> {plan.travelTip}</p>
        </div>
      )}
    </div>
  );
}
