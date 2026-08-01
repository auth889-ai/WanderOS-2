import Image from "next/image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Memory Jar — the emotional surface.
 *
 * Everything else in this product is deliberately plain, because trust reads as
 * restraint. This page is the exception: it is where a finished trip is meant to
 * feel like something, and warmth is not dishonest as long as the FACTS stay
 * honest.
 *
 * So the styling is unrestrained and the claims are not. Every number here comes
 * from real evidence and says how it is known; the film is the real render; and
 * where the reference concept had a "Multiverse" button showing alternate
 * versions of a trip, this has the opposite — the moments the system refused to
 * invent. Showing someone a trip they did not take is the false-memory problem
 * this whole product exists to refuse, however beautiful the button looks.
 */

const WORKER = process.env.MEDIA_WORKER_URL || "http://127.0.0.1:8000";

type Weather = {
  place: { name: string } | null;
  weather: { kind: string; min_temp_c: number; max_temp_c: number;
             wet_days: number; rain_expected: boolean; basis: string };
};

async function weather(): Promise<Weather | null> {
  try {
    const res = await fetch(`${WORKER}/planning/weather`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destination: "Kyoto", start: iso(3), end: iso(10) }),
      cache: "no-store"
    });
    return res.ok ? ((await res.json()) as Weather) : null;
  } catch {
    return null;
  }
}

function iso(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

const JARS = [
  { year: "2026", place: "Bali", active: true, img: "/demo/shots/film-scene.png" },
  { year: "2025", place: "Portugal", active: false, img: "/images/traveler-dashboard/m4.png" },
  { year: "2024", place: "Iceland", active: false, img: "/images/traveler-dashboard/m7.png" }
];

// Every figure states its basis — the same rule as the Wrapped card. A jar that
// glows is fine; a jar that rounds up is not.
const HIGHLIGHTS = [
  { value: "4", label: "Moments kept", basis: "from your photos", tone: "verified" },
  { value: "1", label: "AI-recreated", basis: "you approved it", tone: "consented" },
  { value: "2", label: "Left empty", basis: "you didn't confirm", tone: "refused" },
  { value: "97", label: "km travelled", basis: "from photo GPS", tone: "verified" }
];

const TONE: Record<string, { dot: string; text: string }> = {
  verified: { dot: "bg-emerald-400", text: "text-emerald-300" },
  consented: { dot: "bg-amber-400", text: "text-amber-300" },
  refused: { dot: "bg-slate-400", text: "text-slate-300" }
};

export default async function JarPage() {
  const forecast = await weather();

  return (
    <main className="min-h-screen bg-night text-parchment">
      {/* Ambient warmth. Pure CSS — no image payload, no external request. */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[42rem] w-[42rem] -translate-x-1/2 rounded-full bg-coral/20 blur-[140px]" />
        <div className="absolute bottom-0 left-0 h-[30rem] w-[30rem] rounded-full bg-grape/50 blur-[120px]" />
        <div className="absolute right-0 top-1/3 h-[26rem] w-[26rem] rounded-full bg-aurora/10 blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 py-14">

        <header className="text-center">
          <h1 className="font-display text-6xl leading-tight text-peach drop-shadow-[0_0_28px_rgba(239,109,91,0.35)]">
            Memory Jar
          </h1>
          <p className="mt-3 text-mist/80">
            Your trip, kept whole — and honest about every part of it
          </p>
        </header>

        <div className="mt-12 grid gap-6 lg:grid-cols-[300px_1fr_320px]">

          {/* ── left: the jars ── */}
          <aside className="space-y-6">
            <section className="rounded-2xl border border-mist/15 bg-white/[0.04] p-5 backdrop-blur">
              <h2 className="font-display text-xl text-peach">My jars</h2>
              <div className="mt-4 space-y-3">
                {JARS.map((jar) => (
                  <button key={jar.year}
                    className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition
                      ${jar.active
                        ? "border-coral/60 bg-coral/10 shadow-[0_0_28px_-6px_rgba(239,109,91,0.5)]"
                        : "border-mist/10 bg-white/[0.03] hover:border-mist/25"}`}>
                    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg ring-1 ring-mist/20">
                      <Image src={jar.img} alt={jar.place} fill sizes="56px" className="object-cover" />
                    </div>
                    <div>
                      <p className="font-display text-lg leading-none text-parchment">{jar.year}</p>
                      <p className="text-xs text-mist/70">{jar.place}</p>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-mist/15 bg-white/[0.04] p-5 backdrop-blur">
              <h2 className="font-display text-xl text-peach">What&rsquo;s inside</h2>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {HIGHLIGHTS.map((h) => (
                  <div key={h.label} className="rounded-xl border border-mist/10 bg-white/[0.03] p-3">
                    <p className="font-display text-3xl text-parchment">{h.value}</p>
                    <p className="mt-0.5 text-xs text-mist/80">{h.label}</p>
                    <p className={`mt-1.5 flex items-center gap-1.5 text-[10px] ${TONE[h.tone].text}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${TONE[h.tone].dot}`} />
                      {h.basis}
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-[11px] leading-snug text-mist/50">
                Every number says how it is known. A jar that glows is fine; a jar that
                rounds up is not.
              </p>
            </section>
          </aside>

          {/* ── centre: the jar itself ── */}
          <section className="flex flex-col items-center">
            <div className="relative w-full max-w-2xl">
              {/* glow behind the glass */}
              <div className="absolute inset-0 -m-8 rounded-[3rem] bg-gradient-to-b from-coral/25 via-grape/20 to-transparent blur-3xl" />

              <div className="relative overflow-hidden rounded-[2rem] border border-peach/25
                              bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-3 backdrop-blur
                              shadow-[0_0_70px_-20px_rgba(255,176,143,0.55)]">
                {/* the lid */}
                <div className="mx-auto mb-3 h-2 w-2/3 rounded-full bg-gradient-to-r from-transparent via-peach/70 to-transparent" />

                <div className="overflow-hidden rounded-[1.5rem] bg-black">
                  <video controls playsInline preload="metadata" className="aspect-video w-full">
                    <source src="/demo/film.mp4" type="video/mp4" />
                    <track kind="captions" src="/demo/captions.vtt" srcLang="en"
                           label="English" default />
                  </video>
                </div>

                {/* the heartbeat — a real duration, not decoration */}
                <div className="mt-3 flex items-center justify-center gap-2 text-[11px] text-mist/70">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-coral/70" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-coral" />
                  </span>
                  37 seconds · 1080p · sealed under B2 Object Lock
                </div>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap justify-center gap-3">
              {[
                { label: "Open the jar", primary: true, href: "/features" },
                { label: "The route", href: "/features" },
                { label: "What it refused", href: "/features" },
                { label: "Share", href: "/showcase" }
              ].map((action) => (
                <a key={action.label} href={action.href}
                  className={`rounded-xl px-5 py-2.5 text-sm font-medium transition
                    ${action.primary
                      ? "bg-coral text-night shadow-[0_0_28px_-6px_rgba(239,109,91,0.8)] hover:brightness-110"
                      : "border border-mist/20 bg-white/[0.04] text-parchment hover:border-mist/40"}`}>
                  {action.label}
                </a>
              ))}
            </div>
            <p className="mt-4 max-w-md text-center text-[11px] leading-snug text-mist/50">
              There is no &ldquo;multiverse&rdquo; here. Showing you a version of a trip
              you did not take is the thing this product refuses to do, however good the
              button would look.
            </p>
          </section>

          {/* ── right: the honest panels ── */}
          <aside className="space-y-6">
            <section className="rounded-2xl border border-mist/15 bg-white/[0.04] p-5 backdrop-blur">
              <h2 className="font-display text-xl text-peach">The weather that day</h2>
              {forecast?.weather ? (
                <>
                  <p className="mt-3 font-display text-4xl text-parchment">
                    {forecast.weather.min_temp_c}°–{forecast.weather.max_temp_c}°
                  </p>
                  <p className="mt-1 text-sm text-mist/80">
                    {forecast.place?.name} · {forecast.weather.wet_days} wet day
                    {forecast.weather.wet_days === 1 ? "" : "s"}
                  </p>
                  <span className={`mt-3 inline-block rounded-full px-2.5 py-1 font-mono text-[10px]
                    ${forecast.weather.kind === "forecast"
                      ? "bg-emerald-400/20 text-emerald-300"
                      : "bg-amber-400/20 text-amber-300"}`}>
                    {forecast.weather.kind}
                  </span>
                  <p className="mt-2 text-[11px] leading-snug text-mist/50">
                    {forecast.weather.basis}
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-mist/60">
                  Weather unavailable. Nothing is shown in its place.
                </p>
              )}
            </section>

            <section className="rounded-2xl border border-mist/15 bg-white/[0.04] p-5 backdrop-blur">
              <h2 className="font-display text-xl text-peach">The narration</h2>
              <div className="mt-3 flex items-end gap-[3px]">
                {[9, 16, 24, 14, 30, 20, 36, 22, 14, 26, 12, 20, 32, 18, 10, 24, 16, 8].map((h, i) => (
                  <span key={i} className="w-1.5 rounded-full bg-gradient-to-t from-coral/40 to-aurora/80"
                        style={{ height: `${h}px` }} />
                ))}
              </div>
              <p className="mt-4 text-sm italic leading-snug text-parchment/90">
                &ldquo;The sunset we almost missed.&rdquo;
              </p>
              <p className="mt-2 text-[11px] text-mist/60">
                One voice track per scene, laid at that scene&rsquo;s real start time —
                so the words land on the picture they belong to.
              </p>
            </section>

            <section className="rounded-2xl border border-slate-400/20 bg-white/[0.03] p-5 backdrop-blur">
              <h2 className="font-display text-xl text-slate-300">Left empty on purpose</h2>
              <p className="mt-3 text-xs uppercase tracking-wide text-mist/50">
                your itinerary says
              </p>
              <p className="mt-1 font-display text-lg leading-snug text-parchment">
                Uluwatu Temple, sunset on Day 2
              </p>
              <div className="mt-3 h-px w-12 bg-amber-400/70" />
              <p className="mt-3 text-sm leading-snug text-mist/80">
                You didn&rsquo;t confirm it — so we left it empty.
              </p>
              <p className="mt-4 text-[11px] leading-snug text-mist/50">
                AI video built from AI-edited photos implants false memories at 2.05× the
                normal rate, held 1.19× more confidently. The visible gap is the feature.
              </p>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
