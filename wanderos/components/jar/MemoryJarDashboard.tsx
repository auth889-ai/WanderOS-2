"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Play, Pause, Sparkles, Globe2, Clock, CloudRain, Stars, Heart, Film, Music, Mic, Leaf, ChevronRight, Clapperboard } from "lucide-react";
import { MovieStudio } from "./MovieStudio";
import { CodeJar } from "./CodeJar";
import { WeatherDome } from "./WeatherDome";
import { AmbientSound } from "./AmbientSound";
import dynamic from "next/dynamic";

const MemoryGalaxy = dynamic(() => import("./MemoryGalaxy").then((m) => m.MemoryGalaxy), { ssr: false });
const TimeTunnel = dynamic(() => import("./TimeTunnel").then((m) => m.TimeTunnel), { ssr: false });

type Recap = { topMoment: string; mood: string; favoriteFeeling: string; growthLine: string; narration: string; emotionalWeather: string; particleType: "sakura" | "rain" | "sparks" | "snow" | "fireflies"; glow: string };
type YearJar = { year: number; count: number; place: string; cover: string | null };
type Overview = {
  profile: { name: string; memoriesCount: number; countriesCount: number; cinematicCount: number };
  yearJars: YearJar[];
  recentMemory: { place: string; date: string; caption: string; image: string | null } | null;
  heroImage: string | null;
  backgroundImage: string | null;
  photos: string[];
  variants: { style: string; url: string | null }[];
  recap: Recap | null;
};

import { LivingJar } from "./LivingJar";

const PANEL = "rounded-2xl border border-[#e7b86a]/25 bg-[#2a1730]/45 p-4 shadow-[0_8px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl";
const PORTALS = [
  { icon: Globe2, label: "Holographic Portal", kind: "portal" },
  { icon: Clock, label: "Time Collapse Tunnel", kind: "tunnel" },
  { icon: CloudRain, label: "Emotional Weather", kind: "weather" },
  { icon: Stars, label: "Memory Multiverse", kind: "multiverse" }
];
const FEATURES = [
  { icon: Heart, title: "Living Jar Animation", sub: "Breathing & Glowing" },
  { icon: Film, title: "AI Movie Trailer", sub: "Cinematic Intro" },
  { icon: Music, title: "Sound DNA", sub: "Personalized Music" },
  { icon: Mic, title: "Voice Echo Playback", sub: "Hear Your Past Voice" },
  { icon: Leaf, title: "Forgotten Memory Revival", sub: "Rediscover Moments" }
];
const ALT_STYLES = ["Cyberpunk", "Snowy", "Studio Ghibli"];
type SavedJarT = { id: string; name: string; mode: string; jar_src: string | null; scene_url: string | null; movie_url: string | null; movie_id: string | null };
const JAR_TEMPLATES: [string, string][] = [
  ["t0", "Kyoto"], ["t1", "Santorini"], ["t2", "Paris"], ["t3", "Swiss Alps"], ["t4", "Maldives"], ["t5", "Autumn"],
  ["t6", "Venice"], ["t7", "Desert"], ["t8", "Aurora"], ["t9", "Mountain"], ["t10", "Tuscany"],
  ["t11", "New York"], ["t12", "Dubai"], ["t13", "Bali"], ["t14", "Cappadocia"], ["t15", "London"], ["t16", "Rome"],
  ["t17", "Fjords"], ["t18", "Provence"], ["t19", "Safari"], ["t20", "Beach"], ["t21", "Waterfall"], ["t22", "Ocean"],
  ["t23", "Camping"], ["t24", "Sydney"], ["t25", "Prague"]
];

export function MemoryJarDashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [showMovie, setShowMovie] = useState(false);
  const [showGalaxy, setShowGalaxy] = useState(false);
  const [showTunnel, setShowTunnel] = useState(false);
  const [tpl, setTpl] = useState("t0");
  const [jarMode, setJarMode] = useState<"image" | "code">("image");
  const [codeScene, setCodeScene] = useState<string | null>(null);
  const [codeCaption, setCodeCaption] = useState("");
  const [customTpls, setCustomTpls] = useState<string[]>([]);
  const [genText, setGenText] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  const [aiRemaining, setAiRemaining] = useState<number | null>(null);
  const [savedJars, setSavedJars] = useState<SavedJarT[]>([]);
  const [saveName, setSaveName] = useState("");
  const [showSave, setShowSave] = useState(false);
  const [lastMovie, setLastMovie] = useState<{ url: string; id: string } | null>(null);
  const [toast, setToast] = useState("");

  function refreshSaved() { fetch("/api/memory-jars/saved").then((r) => r.json()).then((j) => setSavedJars(j.jars || [])).catch(() => {}); }

  async function doSaveJar() {
    if (!saveName.trim()) return;
    const body = { name: saveName.trim(), mode: jarMode, jarSrc: jarMode === "image" ? tpl : null, sceneUrl: jarMode === "code" ? codeScene : null, movieUrl: lastMovie?.url ?? null, movieId: lastMovie?.id ?? null };
    const r = await fetch("/api/memory-jars/saved", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({}));
    if (r.jar) { setSavedJars((j) => [r.jar, ...j]); setShowSave(false); setSaveName(""); flash(`💾 Saved “${r.jar.name}”${lastMovie ? " (with movie)" : ""}`); }
    else flash(r.error || "Couldn’t save.");
  }
  function loadJar(s: SavedJarT) {
    if (s.mode === "code" && s.scene_url) { setCodeScene(s.scene_url); setCodeCaption(s.name); setJarMode("code"); }
    else { pickTpl(s.jar_src || "t0"); }
    if (s.movie_url) setLastMovie({ url: s.movie_url, id: s.movie_id || "" });
    flash(`Loaded “${s.name}”`);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function copySavedJar(id: string) { const r = await fetch(`/api/memory-jars/saved/${id}`, { method: "POST" }).then((x) => x.json()).catch(() => ({})); if (r.jar) { setSavedJars((j) => [r.jar, ...j]); flash("Copied"); } }
  async function renameSavedJar(id: string, current: string) { const name = typeof window !== "undefined" ? window.prompt("Rename jar", current) : null; if (!name?.trim()) return; await fetch(`/api/memory-jars/saved/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) }); setSavedJars((j) => j.map((x) => x.id === id ? { ...x, name: name.trim() } : x)); }
  async function deleteSavedJar(id: string) { await fetch(`/api/memory-jars/saved/${id}`, { method: "DELETE" }); setSavedJars((j) => j.filter((x) => x.id !== id)); }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const s = localStorage.getItem("jarTemplate"); if (s) setTpl(s);
    try { const c = JSON.parse(localStorage.getItem("jarCustom") || "[]"); if (Array.isArray(c)) setCustomTpls(c); } catch { /* ignore */ }
    fetch("/api/memory-jars/jar").then((r) => r.json()).then((j) => setAiRemaining(j.remaining ?? null)).catch(() => {});
    refreshSaved();
  }, []);
  function pickTpl(id: string) { setTpl(id); setJarMode("image"); if (typeof window !== "undefined") localStorage.setItem("jarTemplate", id); }
  const jarSrc = (t: string) => (t.startsWith("http") ? t : `/jar/templates/${t}.png`);

  /** OPTION 2 — Dynamic code jar: a real Unsplash photo of ANY place (free, unlimited) rendered inside the code-built #35 jar. */
  async function makeDynamicJar() {
    if (!genText.trim() || genBusy) return;
    setGenBusy(true);
    const r = await fetch("/api/memory-jars/scene-img", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: genText.trim() }) }).then((x) => x.json()).catch(() => ({}));
    setGenBusy(false);
    if (r.url) { setCodeScene(r.url); setCodeCaption(genText.trim()); setJarMode("code"); flash(`🎨 Dynamic jar built for “${genText.trim()}”`); }
    else flash(r.error || "No photo found — try another place.");
  }

  /** Way 2 — premium AI jar: reads your memories (semantic RAG) → personalized #33-shaped jar. 2/day. */
  async function makeAiJar() {
    if (genBusy || aiRemaining === 0) return;
    setGenBusy(true);
    const r = await fetch("/api/memory-jars/jar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hint: genText.trim() || undefined }) }).then((x) => x.json()).catch(() => ({}));
    setGenBusy(false);
    if (typeof r.remaining === "number") setAiRemaining(r.remaining);
    if (r.url) {
      const next = [r.url, ...customTpls].slice(0, 12);
      setCustomTpls(next);
      if (typeof window !== "undefined") localStorage.setItem("jarCustom", JSON.stringify(next));
      pickTpl(r.url); setGenText("");
      flash(`✨ ${r.title || "Your AI jar"} created from your memories`);
    } else flash(r.error || "Couldn’t generate your jar — try again.");
  }
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/memory-jars/overview").then((r) => r.json()).then((j: Overview) => { setData(j); setLoading(false); }).catch(() => setLoading(false));
    return () => { if (typeof window !== "undefined") window.speechSynthesis?.cancel(); };
  }, []);

  function flash(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4000);
  }

  function toggleNarration() {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return; }
    const text = data?.recap?.narration;
    if (!text) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.92; u.pitch = 1.05;
    u.onend = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
    setSpeaking(true);
  }

  async function render(kind: string, label: string) {
    flash(`✨ ${label} — requesting cinematic render…`);
    const r = await fetch("/api/memory-jars/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) }).then((x) => x.json()).catch(() => ({}));
    flash(r.message || (r.ready ? `🎬 ${label} ready` : `${label}: render queued`));
  }

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center text-white/70"><Loader2 className="mr-3 animate-spin text-[#c98bff]" /> Opening your memory jars…</div>;
  }

  const recap = data?.recap;
  const glow = recap?.glow || "#e7b86a";
  const jars = data?.yearJars ?? [];

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* cinematic generated backdrop */}
      {data?.backgroundImage
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={data.backgroundImage} alt="" className="pointer-events-none fixed inset-0 -z-20 h-full w-full object-cover" />
        : <div className="pointer-events-none fixed inset-0 -z-20" style={{ background: "radial-gradient(ellipse at 50% 30%, #6a3a72 0%, #3f2356 38%, #241338 70%, #160d26 100%)" }} />}
      {/* readability overlay + vignette */}
      <div className="pointer-events-none fixed inset-0 -z-10" style={{ background: "linear-gradient(180deg, rgba(16,9,28,0.62), rgba(16,9,28,0.5) 40%, rgba(12,7,22,0.72)), radial-gradient(ellipse at center, transparent 50%, rgba(8,5,16,0.6) 100%)" }} />
      {/* emotional weather dome */}
      <WeatherDome weather={recap?.emotionalWeather} />

      {/* header */}
      <div className="mb-6">
        <h1 className="text-4xl font-bold tracking-tight text-[#f3e3c0]" style={{ fontFamily: "Georgia, serif" }}>Memory Jar Ultimate</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-white/60">
          AI-Powered Cinematic Memory Experience
          {["Gemini", "Veo", "Three.js"].map((t) => <span key={t} className="rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-xs text-[#cda7ff]">{t}</span>)}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_minmax(300px,400px)_1fr]">
        {/* LEFT */}
        <div className="space-y-5">
          <div className={PANEL}>
            <div className="flex items-center gap-3">
              <div className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-[#c98bff] to-[#ef6d5b] text-xl font-bold text-white">{data?.profile.name?.[0]?.toUpperCase() ?? "U"}</div>
              <div>
                <p className="font-semibold text-white">{data?.profile.name}</p>
                <p className="text-xs text-[#cda7ff]">Collecting memories around the world</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              {[["Countries", data?.profile.countriesCount], ["Memories", data?.profile.memoriesCount], ["Cinematic", data?.profile.cinematicCount]].map(([l, v]) => (
                <div key={l as string} className="rounded-xl border border-white/10 bg-white/5 py-3">
                  <p className="text-2xl font-bold text-[#f3e3c0]">{v as number}</p>
                  <p className="text-[11px] text-white/55">{l as string}</p>
                </div>
              ))}
            </div>
          </div>

          <div className={PANEL}>
            <div className="mb-3 flex items-center justify-between">
              <div><p className="font-semibold text-white">Year Jars</p><p className="text-xs text-white/50">Every year holds a universe</p></div>
              <Link href="/memory-books" className="text-xs text-[#cda7ff] hover:underline">View All</Link>
            </div>
            {jars.length ? (
              <div className="grid grid-cols-4 gap-2">
                {jars.slice(0, 4).map((j, i) => (
                  <Link key={j.year} href="/memory-books" className={`group overflow-hidden rounded-xl border ${i === 0 ? "border-[#c98bff]" : "border-white/10"} bg-white/5`}>
                    <div className="relative h-20">
                      {j.cover
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={j.cover} alt="" className="h-full w-full object-cover transition group-hover:scale-105" />
                        : <div className="h-full w-full bg-gradient-to-b from-[#3a2b66] to-[#241338]" />}
                      {i === 0 && <span className="absolute right-1 top-1"><Heart size={12} fill="#ef6d5b" stroke="#ef6d5b" /></span>}
                    </div>
                    <p className="px-1 py-1 text-center text-xs font-semibold text-white">{j.year}</p>
                  </Link>
                ))}
              </div>
            ) : <p className="text-sm text-white/50">No memories yet — share posts and they fill your jars.</p>}
          </div>

          {data?.recentMemory && (
            <div className={PANEL}>
              <p className="mb-2 font-semibold text-white">Recent Memory</p>
              <div className="flex gap-3">
                {data.recentMemory.image
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={data.recentMemory.image} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover" />
                  : <div className="h-20 w-20 shrink-0 rounded-xl bg-white/10" />}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[#f3e3c0]">{data.recentMemory.place}</p>
                  <p className="text-xs text-white/45">{data.recentMemory.date}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-white/65">{data.recentMemory.caption}</p>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Link href="/memory-books" className="flex-1 rounded-lg bg-[#7b53d4] py-2 text-center text-xs font-semibold text-white">▶ Open Memory</Link>
                <Link href="/discover" className="flex-1 rounded-lg border border-white/15 py-2 text-center text-xs text-white/80">✦ Recreate Trip</Link>
              </div>
            </div>
          )}
        </div>

        {/* CENTER — the living jar */}
        <div className="flex flex-col items-center justify-start pt-4">
          {jarMode === "code"
            ? <CodeJar scene={codeScene} glow={glow} caption={codeCaption || recap?.topMoment} photos={data?.photos ?? []} />
            : <LivingJar image={jarSrc(tpl)} glow={glow} particle={recap?.particleType || "sakura"} caption={recap?.topMoment} photos={data?.photos ?? []} />}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button onClick={() => setShowMovie(true)} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#e7b86a] to-[#ef6d5b] px-5 py-2.5 text-sm font-bold text-[#1c1230] shadow-[0_10px_28px_rgba(231,184,106,0.35)] transition hover:-translate-y-0.5">
              <Clapperboard size={16} /> Make a movie in this jar
            </button>
            <button onClick={() => { setShowSave((s) => !s); setSaveName(codeCaption || ""); }} className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white/85 hover:border-[#e7b86a]">
              💾 Save{lastMovie ? " jar + movie" : " this jar"}
            </button>
            <AmbientSound weather={recap?.emotionalWeather} />
          </div>
          {showSave && (
            <div className="mt-2 flex w-full max-w-sm gap-2">
              <input value={saveName} onChange={(e) => setSaveName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doSaveJar()} placeholder="Name this jar… e.g. ‘Eid 2026’" className="flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white placeholder-white/40 outline-none focus:border-[#e7b86a]" />
              <button onClick={doSaveJar} disabled={!saveName.trim()} className="rounded-lg bg-[#7b53d4] px-4 py-2 text-xs font-bold text-white disabled:opacity-50">Save</button>
            </div>
          )}

          {/* jar template picker + custom generator */}
          <div className="mt-4 w-full">
            <p className="mb-2 text-center text-[11px] uppercase tracking-wider text-white/45">① Choose a jar — free, unlimited</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {customTpls.map((url) => (
                <button key={url} onClick={() => pickTpl(url)} title="Your jar" className={`group relative shrink-0 overflow-hidden rounded-lg border-2 transition ${tpl === url ? "border-[#e7b86a]" : "border-white/10 hover:border-white/30"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="custom jar" className="h-14 w-12 object-cover" />
                  <span className="block bg-[#e7b86a]/20 py-0.5 text-center text-[9px] text-[#e7b86a]">Yours</span>
                </button>
              ))}
              {JAR_TEMPLATES.map(([id, label]) => (
                <button key={id} onClick={() => pickTpl(id)} title={label} className={`group shrink-0 overflow-hidden rounded-lg border-2 transition ${tpl === id ? "border-[#e7b86a]" : "border-white/10 hover:border-white/30"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/jar/templates/${id}.png`} alt={label} className="h-14 w-12 object-cover" />
                  <span className={`block py-0.5 text-center text-[9px] ${tpl === id ? "text-[#e7b86a]" : "text-white/50"}`}>{label}</span>
                </button>
              ))}
            </div>
            {/* ② make a jar from your words — 2 options */}
            <p className="mb-2 mt-4 text-center text-[11px] uppercase tracking-wider text-white/45">② Make a jar from any place — type it</p>
            <input value={genText} onChange={(e) => setGenText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && makeDynamicJar()} placeholder="any place or memory… e.g. ‘Sylhet tea gardens’, ‘our Banff night’" className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white placeholder-white/40 outline-none focus:border-[#e7b86a]" />
            <div className="mt-2 flex gap-2">
              <button onClick={makeDynamicJar} disabled={genBusy || !genText.trim()} className="flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-white/85 hover:border-[#e7b86a] disabled:opacity-50">
                <span className="flex items-center gap-1.5 text-xs font-semibold">{genBusy ? <Loader2 size={13} className="animate-spin" /> : <span>🎨</span>} Dynamic jar</span>
                <span className="text-[9px] text-white/40">free · unlimited · any place</span>
              </button>
              <button onClick={makeAiJar} disabled={genBusy || aiRemaining === 0} className="flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg bg-gradient-to-r from-[#c98bff] to-[#ef6d5b] px-3 py-2 text-white disabled:opacity-50">
                <span className="flex items-center gap-1.5 text-xs font-bold">{genBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} AI jar</span>
                <span className="text-[9px] text-white/70">{aiRemaining === 0 ? "used up today" : `premium · ${aiRemaining ?? 2} left today`}</span>
              </button>
            </div>
            <p className="mt-1 text-center text-[10px] text-white/35">🎨 Dynamic = real photo in a code-built #35 jar · ✨ AI = fal generates a new painted jar</p>
          </div>
          <div className="mt-5 grid w-full grid-cols-5 gap-2">
            {[["Open Jar", Sparkles], ["Recreate", Globe2], ["Multiverse", Stars], ["Share", ChevronRight], ["Favorite", Heart]].map(([l, Ic], i) => {
              const Icon = Ic as typeof Heart;
              return <button key={i} onClick={() => i === 0 ? toggleNarration() : render(String(l).toLowerCase(), String(l))} className="flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-white/5 py-2 text-[10px] text-white/70 transition hover:border-[#c98bff] hover:text-white"><Icon size={16} className="text-[#cda7ff]" />{l as string}</button>;
            })}
          </div>
        </div>

        {/* RIGHT */}
        <div className="space-y-5">
          {/* portals */}
          <div className="grid grid-cols-4 gap-2">
            {PORTALS.map((p) => (
              <button key={p.kind} onClick={() => p.kind === "tunnel" ? setShowTunnel(true) : p.kind === "weather" ? render(p.kind, p.label) : setShowGalaxy(true)} className="flex flex-col items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.04] py-3 backdrop-blur-xl transition hover:border-[#c98bff]">
                <p.icon size={20} className="text-[#cda7ff]" />
                <span className="text-center text-[10px] leading-tight text-white/70">{p.label}</span>
              </button>
            ))}
          </div>

          {/* AI narrator */}
          {recap && (
            <div className={PANEL}>
              <div className="mb-2 flex items-center gap-2"><Mic size={15} className="text-[#cda7ff]" /><p className="font-semibold text-white">AI Memory Narrator</p></div>
              <div className="flex items-center gap-3">
                <div className="flex flex-1 items-end gap-[3px]">
                  {Array.from({ length: 28 }).map((_, i) => <span key={i} className="w-[3px] rounded-full bg-[#c98bff]/70" style={{ height: `${8 + (speaking ? Math.abs(Math.sin(i)) * 22 : (i % 5) * 4)}px`, transition: "height .2s", animation: speaking ? `beat ${0.6 + (i % 5) * 0.1}s ease-in-out infinite` : undefined }} />)}
                </div>
                <button onClick={toggleNarration} className="grid h-9 w-9 place-items-center rounded-full bg-[#7b53d4] text-white">{speaking ? <Pause size={15} /> : <Play size={15} />}</button>
              </div>
              <p className="mt-3 text-sm italic leading-relaxed text-white/75">“{recap.narration}”</p>
            </div>
          )}

          {/* yearly recap */}
          {recap && (
            <div className={PANEL}>
              <div className="mb-3 flex items-center justify-between"><p className="font-semibold text-white">Yearly Emotional Recap <span className="text-[#cda7ff]">{jars[0]?.year ?? ""}</span></p><span className="rounded-full bg-[#7b53d4]/40 px-2 py-0.5 text-[10px] text-[#e3d2ff]">AI Generated</span></div>
              <div className="grid grid-cols-3 gap-2">
                {[["Top Moment", recap.topMoment], ["Mood", recap.mood], ["Favorite Feeling", recap.favoriteFeeling]].map(([l, v]) => (
                  <div key={l} className="rounded-xl border border-white/10 bg-white/5 p-2.5"><p className="text-[10px] text-[#cda7ff]">{l}</p><p className="mt-0.5 text-xs font-semibold text-white">{v}</p></div>
                ))}
              </div>
              <p className="mt-3 text-sm italic text-white/70">“{recap.growthLine}”</p>
            </div>
          )}

          {/* alternate realities */}
          <div className={PANEL}>
            <div className="mb-3 flex items-center justify-between">
              <div><p className="font-semibold text-white">Alternate Realities</p><p className="text-xs text-white/50">See your memory in different worlds</p></div>
              <button onClick={() => render("multiverse", "Alternate Realities")} className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-[#cda7ff] hover:border-[#c98bff]">Generate More</button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(data?.variants?.length ? data.variants : ALT_STYLES.map((style) => ({ style, url: null }))).map((v) => (
                <div key={v.style} className="group overflow-hidden rounded-xl border border-white/10 bg-white/5 text-left">
                  {v.url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={v.url} alt={v.style} className="h-16 w-full object-cover transition group-hover:scale-105" />
                    : <div className="grid h-16 place-items-center bg-gradient-to-br from-[#3a2b66] to-[#5a2f6e] text-white/40"><Stars size={16} /></div>}
                  <p className="px-1.5 py-1 text-[10px] font-medium text-white/75">{v.style}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* My Jars — history */}
      {savedJars.length > 0 && (
        <div className={`${PANEL} mt-6`}>
          <p className="mb-3 flex items-center gap-2 font-semibold text-white">🫙 My Jars <span className="text-xs font-normal text-white/45">· your saved jars &amp; movies</span></p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {savedJars.map((s) => (
              <div key={s.id} className="group overflow-hidden rounded-xl border border-white/10 bg-white/5">
                <button onClick={() => loadJar(s)} className="block w-full">
                  <div className="relative h-24">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.mode === "code" && s.scene_url ? s.scene_url : (s.jar_src?.startsWith("http") ? s.jar_src : `/jar/templates/${s.jar_src || "t0"}.png`)} alt={s.name} className="h-full w-full object-cover" />
                    {s.movie_url && <span className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] text-[#e7b86a]">🎬 movie</span>}
                  </div>
                  <p className="truncate px-2 pt-1.5 text-left text-xs font-semibold text-white">{s.name}</p>
                </button>
                <div className="flex items-center gap-1 px-2 pb-2 pt-1 text-white/50">
                  {s.movie_url && <a href={s.movie_url} target="_blank" rel="noreferrer" title="Play movie" className="hover:text-[#e7b86a]"><Play size={13} /></a>}
                  <button onClick={() => copySavedJar(s.id)} title="Copy" className="hover:text-white">⧉</button>
                  <button onClick={() => renameSavedJar(s.id, s.name)} title="Rename" className="hover:text-white">✎</button>
                  <button onClick={() => deleteSavedJar(s.id)} title="Delete" className="ml-auto hover:text-rose-300">🗑</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* bottom feature bar */}
      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {FEATURES.map((f) => (
          <button key={f.title} onClick={() => f.title === "AI Movie Trailer" ? setShowMovie(true) : render(f.title.toLowerCase().replace(/\s/g, "-"), f.title)} className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-left backdrop-blur-xl transition hover:border-[#c98bff]">
            <f.icon size={20} className="shrink-0 text-[#cda7ff]" />
            <div className="min-w-0"><p className="truncate text-xs font-semibold text-white">{f.title}</p><p className="truncate text-[10px] text-white/50">{f.sub}</p></div>
          </button>
        ))}
      </div>

      {toast && <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-[#c98bff]/40 bg-[#1c1330] px-4 py-3 text-sm text-white shadow-2xl backdrop-blur-xl">{toast}</div>}
      {showMovie && <MovieStudio onClose={() => setShowMovie(false)} onFilmReady={(url, id) => { setLastMovie({ url, id }); flash("🎬 Movie ready — tap 💾 Save to keep it in a jar"); }} />}
      {showGalaxy && <MemoryGalaxy photos={(data?.photos ?? []).filter(Boolean)} onClose={() => setShowGalaxy(false)} />}
      {showTunnel && <TimeTunnel photos={(data?.photos ?? []).filter(Boolean)} onClose={() => setShowTunnel(false)} />}
    </div>
  );
}
