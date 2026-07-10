"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { Radar, Loader2, Sparkles, CalendarDays, MapPin, Hotel, Star, Wand2, X, Check, CloudSun, Utensils, Tent, Compass, Wallet, BookOpen, Brain, PiggyBank } from "lucide-react";

type Place = { name: string; address?: string; rating?: number; userRatings?: number; photoUrl?: string; score?: number; matchReason?: string };
type CultureTips = { bestTime: string; gettingAround: string; etiquette: string[]; safety: string; moneyTip: string; dontMiss: string };
type Intel = {
  mode: "place" | "suggest";
  city: string; country: string;
  heroImage: string | null;
  cultureTips: CultureTips | null;
  countryFacts: { currencyCode: string; currencyName: string; currencySymbol: string; languages: string[]; capital: string; drivingSide: string; timezone: string } | null;
  exchange: { from: string; to: string; rate: number } | null;
  wiki: { extract: string; thumbnail: string | null } | null;
  dateWindow: { from: string; to: string; festivalsInRange: string[]; seasonNote: string; bestPlaces: { name: string; why: string; photoUrl?: string; rating?: number; address?: string }[]; tips: string } | null;
  budgetPlan: { feasible: boolean; daysAffordable: number; breakdown: { stay: string; food: string; activities: string; transport: string }; total: string; summary: string; tips: string[] } | null;
  memories: { content: string; type: string; similarity: number }[];
  holidays: { name: string; date: string; daysLeft: number; longWeekend: boolean; types?: string[] }[];
  attractions: Place[];
  food: Place[];
  festivalPlaces: Place[];
  weather: { summary: string } | null;
  stays: { id: string; title: string; city: string; price: string; image_url: string | null }[];
  suggestedTrips: { destination: string; why: string; days?: string; score?: number; matchReason?: string }[];
  cards: { summary: string; triggers: { title: string; body: string }[]; festivals: { name: string; when?: string; why: string }[] };
  prediction: { vibe: string; crowdLevel: string; weatherComfort: string; regretRisk: string; bestFor: string; avoidIf: string } | null;
};
const mapsUrl = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" });
const fmtShort = (iso: string) => new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" });
const holidayKind = (types: string[] = []) => (types.join(" ").match(/religio|hindu|islam|christ|buddh/i) ? "Religious" : types.join(" ").match(/national/i) ? "National" : types.join(" ").match(/season|equinox|solstice/i) ? "Seasonal" : "Observance");

const CARD = "rounded-2xl border border-[#f0e6dc] bg-white p-5 shadow-[0_10px_30px_rgba(20,12,8,0.06)]";
const INK = "text-[#312b27]"; const SUB = "text-[#8a7e76]";

function MatchBadge({ score }: { score?: number }) {
  if (score == null) return null;
  const tone = score >= 75 ? "bg-emerald-100 text-emerald-700" : score >= 50 ? "bg-amber-100 text-amber-700" : "bg-[#efe6dc] text-[#8a7e76]";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${tone}`}>{score}% match</span>;
}
const LEVEL: Record<string, string> = { low: "bg-emerald-100 text-emerald-700", medium: "bg-amber-100 text-amber-700", high: "bg-rose-100 text-rose-700" };
function Meter({ label, level, invert }: { label: string; level: string; invert?: boolean }) {
  const key = invert ? ({ low: "high", medium: "medium", high: "low" }[level] ?? "medium") : level;
  return <div className={`rounded-xl p-3 text-center ${LEVEL[key] ?? LEVEL.medium}`}><p className="text-[10px] uppercase tracking-wider opacity-70">{label}</p><p className="text-base font-bold capitalize">{level}</p></div>;
}
function SectionHead({ Icon, children }: { Icon: typeof MapPin; children: React.ReactNode }) {
  return <p className={`mb-3 flex items-center gap-2 text-base font-semibold ${INK}`}><span className="grid h-7 w-7 place-items-center rounded-lg bg-[#fce8e3] text-[#ef6d5b]"><Icon size={15} /></span>{children}</p>;
}
function Tip({ label, text }: { label: string; text: string }) {
  return <div className="rounded-xl border border-[#f0e6dc] bg-[#fdf8f3] p-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-[#ef6d5b]">{label}</p><p className="mt-0.5 text-sm text-[#4a423b]">{text}</p></div>;
}
function PhotoCard({ name, photoUrl, rating, why, sub, badge, href, fallbackIcon: Fallback = MapPin }: { name: string; photoUrl?: string; rating?: number; why?: string; sub?: string; badge?: number; href: string; fallbackIcon?: typeof MapPin }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="group block overflow-hidden rounded-xl border border-[#f0e6dc] bg-[#fdf8f3] transition hover:-translate-y-1 hover:border-[#ef6d5b]">
      <div className="relative">
        {photoUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={photoUrl} alt="" className="h-32 w-full object-cover transition group-hover:scale-105" />
          : <div className="grid h-32 place-items-center text-[#cbb8a6]"><Fallback /></div>}
        {badge != null && <span className="absolute right-2 top-2 rounded-full bg-white/90 px-1 py-0.5"><MatchBadge score={badge} /></span>}
      </div>
      <div className="p-3">
        <p className="flex items-start justify-between gap-2 text-sm font-semibold text-[#312b27]">{name}{rating ? <span className="flex shrink-0 items-center gap-1 text-xs text-amber-500"><Star size={11} fill="currentColor" />{rating}</span> : null}</p>
        {why ? <p className="mt-0.5 line-clamp-2 text-xs text-[#8a7e76]">{why}</p> : null}
        <p className="mt-1 text-[11px] text-[#a98a74]">{sub || "open in Maps ↗"}</p>
      </div>
    </a>
  );
}

export function TravelRadar() {
  const [query, setQuery] = useState("");
  const [budget, setBudget] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [intel, setIntel] = useState<Intel | null>(null);
  const [error, setError] = useState("");
  const [savedHint, setSavedHint] = useState(false);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    fetch("/api/travel-intel/profile").then((r) => r.json()).then((j: { profile?: { budget?: string; interests?: string[]; last_query?: string } }) => {
      if (!j.profile) return;
      if (j.profile.last_query) setQuery(j.profile.last_query);
      if (j.profile.budget) setBudget(j.profile.budget);
      if (j.profile.interests?.length) setInterests(j.profile.interests);
    }).catch(() => {});
  }, []);

  function addTag(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && tagInput.trim()) {
      e.preventDefault();
      const t = tagInput.trim();
      if (!interests.includes(t) && interests.length < 10) setInterests((x) => [...x, t]);
      setTagInput("");
    }
  }

  async function run(override?: string) {
    const q = (override ?? query).trim();
    if (!q) return;
    if (override) setQuery(override);
    setLoading(true); setError(""); setIntel(null); setSavedHint(false); setTab("overview");
    if (override && typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    const r = await fetch("/api/travel-intel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q, budget: budget || undefined, interests: interests.length ? interests : undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }) });
    const j = (await r.json().catch(() => ({}))) as { intel?: Intel; error?: unknown };
    if (r.ok && j.intel) { setIntel(j.intel); setSavedHint(true); }
    else setError(typeof j.error === "string" ? j.error : "Couldn’t fetch intelligence — try a place name.");
    setLoading(false);
  }

  const inp = "w-full rounded-xl border border-[#f0e6dc] bg-[#fdf8f3] px-4 py-3 text-sm text-[#312b27] placeholder-[#a98a74] outline-none focus:border-[#ef6d5b]";

  const tabs = intel ? ([
    { k: "overview", label: "Overview", show: true },
    { k: "when", label: "Festivals & Dates", show: intel.holidays.length > 0 || intel.festivalPlaces.length > 0 || !!intel.dateWindow },
    { k: "places", label: "Places", show: intel.attractions.length > 0 || intel.suggestedTrips.length > 0 },
    { k: "food", label: "Food", show: intel.food.length > 0 },
    { k: "stays", label: "Stays", show: intel.stays.length > 0 },
    { k: "essentials", label: "Essentials", show: !!intel.cultureTips || !!intel.countryFacts }
  ].filter((t) => t.show)) : [];

  return (
    <div className="mx-auto max-w-4xl">
      <div className="rounded-[28px] bg-gradient-to-b from-[#fdf8f3] to-[#f6ebdd] p-5 shadow-[0_24px_70px_rgba(15,9,20,0.5)] sm:p-7">
        <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-[#ef6d5b]"><Radar size={14} /> Travel Radar</div>
        <h1 className={`text-3xl font-bold ${INK}`}>Predictive travel intelligence</h1>
        <p className={`mt-1 text-sm ${SUB}`}>Real holidays · dated festivals · famous places · food · matching stays · a trip-reality prediction.</p>

        {/* search */}
        <div className="mt-5 rounded-2xl border border-[#f0e6dc] bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
            <input className={inp} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} placeholder="Ask in plain words — “3-day nature trip to Sylhet in July under ৳8000”" />
            <input className={inp} value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="Budget (৳8,500)" />
            <button onClick={() => run()} disabled={loading || !query.trim()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#ef6d5b] px-6 py-3 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(239,109,91,0.35)] transition hover:-translate-y-0.5 disabled:opacity-50">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Scan
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={`text-xs ${SUB}`}>Interests:</span>
            {interests.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full bg-[#fce8e3] px-2.5 py-1 text-xs text-[#ef6d5b]">{t}<button onClick={() => setInterests((x) => x.filter((y) => y !== t))}><X size={11} /></button></span>
            ))}
            <input className="min-w-[150px] flex-1 rounded-lg border border-[#f0e6dc] bg-[#fdf8f3] px-2.5 py-1.5 text-xs text-[#312b27] placeholder-[#a98a74] outline-none focus:border-[#ef6d5b]" value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={addTag} placeholder="add an interest + Enter (saved)" />
            {savedHint && <span className="ml-auto inline-flex items-center gap-1 text-xs text-emerald-600"><Check size={12} /> input saved</span>}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={`text-xs ${SUB}`}>Travel dates (optional):</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-lg border border-[#f0e6dc] bg-[#fdf8f3] px-2.5 py-1.5 text-xs text-[#312b27] outline-none focus:border-[#ef6d5b]" />
            <span className="text-xs text-[#8a7e76]">to</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-lg border border-[#f0e6dc] bg-[#fdf8f3] px-2.5 py-1.5 text-xs text-[#312b27] outline-none focus:border-[#ef6d5b]" />
            <span className="text-xs text-[#a98a74]">→ festivals + season-aware best places for these exact dates</span>
          </div>
        </div>

        {error && <p className="mt-3 rounded-xl border border-[#f3c7bf] bg-[#fdecea] px-3 py-2 text-sm text-[#c0503f]">{error}</p>}

        {loading && (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-2xl border border-[#f0e6dc] bg-white py-12">
            <Loader2 className="animate-spin text-[#ef6d5b]" size={28} />
            <p className={`font-semibold ${INK}`}>Scanning real holidays, festivals, places & weather…</p>
            <p className={`text-xs ${SUB}`}>Calendarific · Google Places · Open-Meteo · Wikipedia · Unsplash · Gemini</p>
          </div>
        )}

        {intel && (
          <div className="mt-6">
            {/* hero */}
            {intel.heroImage && (
              <div className="relative h-52 overflow-hidden rounded-2xl border border-[#f0e6dc] shadow-md">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={intel.heroImage} alt="" className="h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />
                <div className="absolute bottom-4 left-5">
                  <p className="text-xs uppercase tracking-[0.25em] text-white/75">{intel.country}</p>
                  <h2 className="text-3xl font-bold text-white drop-shadow-lg">{intel.city}</h2>
                </div>
              </div>
            )}

            {/* tabs */}
            <div className="sticky top-2 z-10 mt-4 flex gap-1 overflow-x-auto rounded-2xl border border-[#f0e6dc] bg-white/90 p-1 backdrop-blur">
              {tabs.map((t) => (
                <button key={t.k} onClick={() => setTab(t.k)} className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition ${tab === t.k ? "bg-[#ef6d5b] text-white" : "text-[#8a7e76] hover:bg-[#fdf0ec] hover:text-[#312b27]"}`}>{t.label}</button>
              ))}
            </div>

            <div className="mt-5 space-y-5">
              {/* ───────── OVERVIEW ───────── */}
              {tab === "overview" && (
                <>
                  <div className={CARD}>
                    <p className="text-[15px] leading-relaxed text-[#4a423b]">{intel.cards.summary}</p>
                    {intel.weather && <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#fdf8f3] px-3 py-1 text-xs text-[#8a7e76]"><CloudSun size={13} className="text-amber-500" /> Next 7 days: {intel.weather.summary}</p>}
                  </div>

                  {intel.wiki && (
                    <div className={CARD}>
                      <SectionHead Icon={BookOpen}>About {intel.city}</SectionHead>
                      <div className="flex gap-4">
                        {intel.wiki.thumbnail &&
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={intel.wiki.thumbnail} alt="" className="hidden h-24 w-24 shrink-0 rounded-xl object-cover sm:block" />}
                        <p className="text-sm leading-relaxed text-[#4a423b]">{intel.wiki.extract}</p>
                      </div>
                    </div>
                  )}

                  <Link href={`/trips/new?destination=${encodeURIComponent(intel.city)}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#f0e6dc] bg-gradient-to-r from-[#fce8e3] to-[#fbecd6] p-4 transition hover:-translate-y-0.5">
                    <span className="text-sm text-[#4a423b]"><b className="text-[#312b27]">Turn this into a full trip</b> — AI builds a day-by-day itinerary for {intel.city}, grounded in real bookable stays.</span>
                    <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-xl bg-[#ef6d5b] px-4 py-2 text-sm font-semibold text-white"><Sparkles size={15} /> Plan with AI →</span>
                  </Link>

                  {intel.cards.triggers.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {intel.cards.triggers.map((t, i) => (
                        <div key={i} className="rounded-2xl border border-[#f3c7bf] bg-gradient-to-br from-[#fdecea] to-[#fbecd6] p-4">
                          <p className="flex items-center gap-2 font-semibold text-[#312b27]"><Wand2 size={15} className="text-[#ef6d5b]" /> {t.title}</p>
                          <p className="mt-1 text-sm text-[#4a423b]">{t.body}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {intel.prediction && (
                    <div className={CARD}>
                      <p className="text-xs uppercase tracking-[0.2em] text-[#ef6d5b]">Trip-reality prediction</p>
                      <p className="mt-1 text-xl font-bold capitalize text-[#312b27]">{intel.prediction.vibe}</p>
                      <div className="mt-4 grid grid-cols-3 gap-3">
                        <Meter label="Crowd" level={intel.prediction.crowdLevel} />
                        <Meter label="Weather" level={intel.prediction.weatherComfort} invert />
                        <Meter label="Regret risk" level={intel.prediction.regretRisk} />
                      </div>
                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-[#4a423b]"><span className="font-semibold text-emerald-700">Best for:</span> {intel.prediction.bestFor}</p>
                        <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-[#4a423b]"><span className="font-semibold text-rose-700">Avoid if:</span> {intel.prediction.avoidIf}</p>
                      </div>
                    </div>
                  )}

                  {/* budget breakdown — productive use of the budget */}
                  {intel.budgetPlan && (
                    <div className={CARD}>
                      <SectionHead Icon={PiggyBank}>What your budget gets you</SectionHead>
                      <p className="text-sm leading-relaxed text-[#4a423b]">{intel.budgetPlan.summary}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <span className={`rounded-full px-2.5 py-1 font-semibold ${intel.budgetPlan.feasible ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{intel.budgetPlan.feasible ? "✓ Fits your budget" : "Tight — see tips"}</span>
                        <span className="rounded-full bg-[#fce8e3] px-2.5 py-1 font-semibold text-[#ef6d5b]">~{intel.budgetPlan.daysAffordable} days</span>
                        <span className="rounded-full bg-[#fdf8f3] px-2.5 py-1 text-[#8a7e76]">Total: {intel.budgetPlan.total}</span>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        <Tip label="🏨 Stay" text={intel.budgetPlan.breakdown.stay} />
                        <Tip label="🍽 Food" text={intel.budgetPlan.breakdown.food} />
                        <Tip label="🎟 Activities" text={intel.budgetPlan.breakdown.activities} />
                        <Tip label="🚗 Transport" text={intel.budgetPlan.breakdown.transport} />
                      </div>
                      {intel.budgetPlan.tips.length > 0 && <p className="mt-3 rounded-xl bg-[#fbecd6] px-3 py-2 text-xs text-[#8a6a36]">💡 {intel.budgetPlan.tips.join(" · ")}</p>}
                    </div>
                  )}

                  {/* RAG: recalled from the traveler's own memory via pgvector */}
                  {intel.memories.length > 0 && (
                    <div className={CARD}>
                      <SectionHead Icon={Brain}>From your travel memory</SectionHead>
                      <p className="mb-2 text-xs text-[#a98a74]">Recalled from your past posts &amp; trips via semantic search (pgvector RAG) to personalize this.</p>
                      <div className="space-y-2">
                        {intel.memories.map((m, i) => (
                          <div key={i} className="rounded-xl border border-[#f0e6dc] bg-[#fdf8f3] p-3 text-sm text-[#4a423b]"><span className="mr-2 rounded-full bg-[#fce8e3] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#ef6d5b]">{m.type} · {Math.round(m.similarity * 100)}%</span>{m.content}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ───────── FESTIVALS & DATES ───────── */}
              {tab === "when" && (
                <>
                  {intel.dateWindow && (
                    <div className="rounded-2xl border-2 border-[#ef6d5b] bg-white p-5 shadow-[0_10px_30px_rgba(239,109,91,0.12)]">
                      <SectionHead Icon={CalendarDays}>For your dates · {fmtShort(intel.dateWindow.from)} – {fmtShort(intel.dateWindow.to)}</SectionHead>
                      <p className="text-sm leading-relaxed text-[#4a423b]">{intel.dateWindow.seasonNote}</p>
                      {intel.dateWindow.festivalsInRange.length > 0 && <p className="mt-2 text-xs font-medium text-[#ef6d5b]">🎉 Festivals during your trip: {intel.dateWindow.festivalsInRange.join(" · ")}</p>}
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {intel.dateWindow.bestPlaces.map((b, i) => <PhotoCard key={i} name={b.name} photoUrl={b.photoUrl} rating={b.rating} why={b.why} href={mapsUrl(`${b.name} ${intel.city}`)} />)}
                      </div>
                      <p className="mt-3 rounded-xl bg-[#fbecd6] px-3 py-2 text-xs text-[#8a6a36]">💡 {intel.dateWindow.tips}</p>
                    </div>
                  )}

                  {intel.holidays.length > 0 && (
                    <div className={CARD}>
                      <SectionHead Icon={CalendarDays}>Festival &amp; holiday calendar</SectionHead>
                      <div className="space-y-2">
                        {intel.holidays.map((h, i) => {
                          const why = intel.cards.festivals.find((f) => h.name.toLowerCase().includes(f.name.toLowerCase().split(" ")[0]) || f.name.toLowerCase().includes(h.name.toLowerCase().split(" ")[0]))?.why;
                          return (
                            <div key={i} className="flex items-start gap-3 rounded-xl border border-[#f0e6dc] bg-[#fdf8f3] p-3">
                              <div className="grid w-16 shrink-0 place-items-center rounded-lg bg-[#fce8e3] py-1 text-center">
                                <span className="text-[10px] uppercase text-[#c0503f]">{new Date(h.date).toLocaleDateString("en", { month: "short" })}</span>
                                <span className="text-lg font-bold leading-none text-[#ef6d5b]">{new Date(h.date).getDate()}</span>
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#312b27]">{h.name}
                                  <span className="rounded-full bg-[#efe6dc] px-2 py-0.5 text-[10px] font-medium text-[#8a7e76]">{holidayKind(h.types)}</span>
                                  <span className="text-xs font-normal text-[#ef6d5b]">in {h.daysLeft}d</span>{h.longWeekend ? <span className="text-xs text-emerald-600">🎉 long weekend</span> : null}
                                </p>
                                <p className="text-xs text-[#8a7e76]">{fmtDate(h.date)}{why ? ` — ${why}` : ""}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {intel.festivalPlaces.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {intel.festivalPlaces.slice(0, 8).map((p, i) => (
                            <a key={i} href={mapsUrl(`${p.name} ${intel.city}`)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-[#f0e6dc] bg-white px-3 py-1.5 text-xs text-[#4a423b] hover:border-[#ef6d5b]"><Tent size={11} className="text-[#ef6d5b]" /> {p.name} ↗</a>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* ───────── PLACES ───────── */}
              {tab === "places" && (
                <>
                  {intel.suggestedTrips.length > 0 && (
                    <div className={CARD}>
                      <SectionHead Icon={Wand2}>Trips worth taking</SectionHead>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {intel.suggestedTrips.map((t, i) => (
                          <button key={i} onClick={() => run(t.destination)} className="rounded-xl border border-[#f0e6dc] bg-[#fdf8f3] p-4 text-left transition hover:-translate-y-1 hover:border-[#ef6d5b]">
                            <div className="flex items-start justify-between gap-2"><p className="font-semibold text-[#312b27]">{t.destination}{t.days ? <span className="text-[#a98a74]"> · {t.days}</span> : null}</p><MatchBadge score={t.score} /></div>
                            <p className="mt-1 text-sm text-[#4a423b]">{t.matchReason || t.why}</p>
                            <p className="mt-2 text-xs font-semibold text-[#ef6d5b]">Scan this place →</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {intel.attractions.length > 0 && (
                    <div className={CARD}>
                      <SectionHead Icon={MapPin}>Famous places to visit</SectionHead>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {intel.attractions.slice(0, 9).map((a, i) => <PhotoCard key={i} name={a.name} photoUrl={a.photoUrl} rating={a.rating} why={a.matchReason} badge={a.score} href={mapsUrl(`${a.name} ${a.address || intel.city}`)} />)}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ───────── FOOD ───────── */}
              {tab === "food" && intel.food.length > 0 && (
                <div className={CARD}>
                  <SectionHead Icon={Utensils}>Where to eat — local food</SectionHead>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {intel.food.slice(0, 9).map((f, i) => <PhotoCard key={i} name={f.name} photoUrl={f.photoUrl} rating={f.rating} href={mapsUrl(`${f.name} ${f.address || intel.city}`)} fallbackIcon={Utensils} />)}
                  </div>
                </div>
              )}

              {/* ───────── STAYS ───────── */}
              {tab === "stays" && intel.stays.length > 0 && (
                <div className={CARD}>
                  <SectionHead Icon={Hotel}>Book a WanderOS stay here</SectionHead>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {intel.stays.map((s) => (
                      <Link key={s.id} href={`/listing/${s.id}`} className="group block overflow-hidden rounded-xl border border-[#f0e6dc] bg-[#fdf8f3] transition hover:-translate-y-1 hover:border-[#ef6d5b]">
                        {s.image_url
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={s.image_url} alt="" className="h-32 w-full object-cover transition group-hover:scale-105" />
                          : <div className="h-32 bg-[#f3ebe0]" />}
                        <div className="p-3">
                          <p className="truncate text-sm font-semibold text-[#312b27]">{s.title}</p>
                          <p className="text-xs text-[#8a7e76]">{s.city} · <b className="text-[#ef6d5b]">৳{s.price}</b></p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* ───────── ESSENTIALS ───────── */}
              {tab === "essentials" && (
                <>
                  {intel.cultureTips && (
                    <div className={CARD}>
                      <SectionHead Icon={Compass}>Know before you go</SectionHead>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Tip label="Best time" text={intel.cultureTips.bestTime} />
                        <Tip label="Getting around" text={intel.cultureTips.gettingAround} />
                        <Tip label="Safety" text={intel.cultureTips.safety} />
                        <Tip label="Money tip" text={intel.cultureTips.moneyTip} />
                        <Tip label="Don’t miss" text={intel.cultureTips.dontMiss} />
                        {intel.cultureTips.etiquette.length > 0 && <Tip label="Etiquette" text={intel.cultureTips.etiquette.join(" · ")} />}
                      </div>
                    </div>
                  )}
                  {(intel.countryFacts || intel.exchange) && (
                    <div className={CARD}>
                      <SectionHead Icon={Wallet}>Country essentials &amp; money</SectionHead>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {intel.countryFacts && (
                          <>
                            <Tip label="Currency" text={`${intel.countryFacts.currencyName} (${intel.countryFacts.currencySymbol} · ${intel.countryFacts.currencyCode})`} />
                            <Tip label="Language" text={intel.countryFacts.languages.join(", ")} />
                            <Tip label="Capital" text={intel.countryFacts.capital} />
                            <Tip label="Drives on" text={intel.countryFacts.drivingSide} />
                            <Tip label="Timezone" text={intel.countryFacts.timezone} />
                          </>
                        )}
                        {intel.exchange && <Tip label="Exchange rate" text={`1 ${intel.exchange.from} ≈ ${intel.exchange.rate.toFixed(2)} ${intel.exchange.to}`} />}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
