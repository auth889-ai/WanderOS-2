import Image from "next/image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The feature gallery in the Memory Jar aesthetic — built to be screenshotted.
 *
 * `/features` is the plain, readable version. This is the same content in the
 * warm dark treatment, for a submission page or a demo thumbnail, where the
 * first job is to make someone want to look.
 *
 * The rule that keeps this honest: styling is unrestrained, claims are not.
 * Every image is a frame from the real render, and every feature is stated as
 * the PROBLEM it solves rather than its name — "Sensory budget" teaches nobody
 * anything; "planners count kilometres, not exhaustion" is the actual claim.
 */

const SHOTS = [
  { src: "/demo/shots/film-route.png", tag: "THE ROUTE",
    title: "It draws itself",
    body: "Line grows, stops land as reached, distance climbs. Every point is real photo GPS — a stop without coordinates is not drawn." },
  { src: "/demo/shots/film-gap.png", tag: "THE REFUSAL",
    title: "It shows what it would not invent",
    body: "AI video from AI-edited photos implants false memories at 2.05×. The visible gap is the feature, not a failure." },
  { src: "/demo/shots/film-scene.png", tag: "PROVENANCE",
    title: "Every scene says where it came from",
    body: "Green FROM YOUR PHOTO. Amber AI-RECREATED · YOU APPROVED. Never confusable at a glance." },
  { src: "/demo/shots/film-verify.png", tag: "THE SEAL",
    title: "What the film is made of",
    body: "Real, recreated, and left empty — with the sealed hash. Tamper-evidence a viewer cannot act on is decoration." },
  { src: "/demo/shots/wrapped.png", tag: "YEAR IN TRAVEL",
    title: "Every number states its basis",
    body: "With no geotagged photos, distance reports unknown — not 0 km. Zero would be a lie." },
  { src: "/demo/shots/route.png", tag: "EVIDENCE",
    title: "17 km · 83 km · 97 km",
    body: "Three frames of the same route. The counter climbs with the line, never ahead of it." }
];

const PILLARS = [
  {
    tag: "01", name: "It will not invent your past",
    stat: "2.05×", statLabel: "false-memory rate for AI video (CHI 2025)",
    items: [
      "Six truth statuses — INFERRED can never generate without you",
      "Silence means no. One code path can promote a claim",
      "Refusals rendered as cards inside the film",
      "GPS physically stripped before anything is shared"
    ]
  },
  {
    tag: "02", name: "It will not hand you an impossible plan",
    stat: "~90%", statLabel: "of AI itineraries contain at least one error",
    items: [
      "Real street routing — prev_end + travel + buffer ≤ next_start",
      "Closed weekdays, opening hours, unbooked tickets",
      "A 4 km walk given 20 minutes is rejected with the arithmetic",
      "Group fairness maximises the worst-off member, not the average"
    ]
  },
  {
    tag: "03", name: "You can overrule it, and the correction is kept",
    stat: "#1", statLabel: "complaint about the 18M-user incumbent",
    items: [
      "Phantom GPS stops can finally be deleted",
      "The original inference survives — history is never rewritten",
      "Corrections outrank inference permanently",
      "Layover artefacts are suggested unprompted"
    ]
  },
  {
    tag: "04", name: "It works when nothing else does",
    stat: "14", statLabel: "provider rungs across 4 vendors",
    items: [
      "Offline pack: one file, zero network calls, no secrets inside",
      "Emergency numbers assembled before departure — 911 is not universal",
      "Accessibility graded by who said so; unknown is never yes",
      "A dead vendor drops one rung, not the run"
    ]
  }
];

const SECTIONS = [
  { n: "Evidence Autopilot", count: "6/6", line: "Curation, truth model, consent, sensitive controls, evidence-linked route, collaborative inbox" },
  { n: "Before the trip", count: "8/8", line: "Traveler DNA, dream-to-destination, compare futures, constraint-safe itinerary, group fairness, budget, readiness vault, packing" },
  { n: "During the trip", count: "6/6", line: "Live day controller, sensory budget, accessibility layer, offline pack, culture copilot, safety guardian" },
  { n: "When it goes wrong", count: "4/4", line: "Disruption recovery, passenger rights, sealed claim capsule, baggage twin" },
  { n: "The film", count: "5/5", line: "Capture director, story director, autonomous critic, cross-provider failover, many outputs" },
  { n: "Trust and storage", count: "4/4", line: "Experience passport, B2 evidence graph, Object Lock and tamper verification, durable workflow" }
];

export default function GalleryPage() {
  return (
    <main className="min-h-screen bg-night text-parchment">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-52 left-1/2 h-[46rem] w-[46rem] -translate-x-1/2 rounded-full bg-coral/20 blur-[150px]" />
        <div className="absolute bottom-0 left-0 h-[32rem] w-[32rem] rounded-full bg-grape/50 blur-[130px]" />
        <div className="absolute right-0 top-1/2 h-[28rem] w-[28rem] rounded-full bg-aurora/10 blur-[130px]" />
      </div>

      <div className="relative mx-auto max-w-6xl px-6 py-16">

        <header className="text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-mist/60">
            WanderOS Travel Autopilot
          </p>
          <h1 className="mx-auto mt-5 max-w-4xl font-display text-6xl leading-[1.05] text-peach
                         drop-shadow-[0_0_36px_rgba(239,109,91,0.4)]">
            The only travel AI that refuses to make things up
          </h1>
          <p className="mt-5 text-lg text-mist/80">— and can prove it.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-2 text-[11px]">
            {["33 features", "127 tests", "14 provider rungs · 4 vendors",
              "B2 Object Lock · ed25519", "EU AI Act Art. 50"].map((chip) => (
              <span key={chip}
                className="rounded-full border border-mist/20 bg-white/[0.05] px-3 py-1 font-mono text-mist/80 backdrop-blur">
                {chip}
              </span>
            ))}
          </div>
        </header>

        {/* the four pillars */}
        <section className="mt-20 grid gap-5 md:grid-cols-2">
          {PILLARS.map((p) => (
            <article key={p.tag}
              className="rounded-2xl border border-mist/15 bg-white/[0.04] p-7 backdrop-blur
                         transition hover:border-coral/40">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[11px] text-mist/50">{p.tag}</p>
                  <h2 className="mt-2 font-display text-2xl leading-snug text-parchment">{p.name}</h2>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-display text-4xl text-coral drop-shadow-[0_0_18px_rgba(239,109,91,0.5)]">
                    {p.stat}
                  </p>
                </div>
              </div>
              <p className="mt-1 text-right text-[10px] leading-tight text-mist/50">{p.statLabel}</p>
              <ul className="mt-5 space-y-2">
                {p.items.map((item) => (
                  <li key={item} className="flex gap-2.5 text-sm leading-snug text-mist/85">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-peach/80" />
                    {item}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>

        {/* the film */}
        <section className="mt-20">
          <h2 className="text-center font-display text-4xl text-peach">The film</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-mist/70">
            1080p · per-scene narration · burned captions and a selectable track · a route
            that draws itself · sealed and tamper-evident
          </p>
          <div className="relative mx-auto mt-8 max-w-3xl">
            <div className="absolute inset-0 -m-6 rounded-[2.5rem] bg-gradient-to-b from-coral/25 to-transparent blur-3xl" />
            <div className="relative overflow-hidden rounded-[1.75rem] border border-peach/25 bg-white/[0.05] p-2.5 backdrop-blur
                            shadow-[0_0_70px_-20px_rgba(255,176,143,0.5)]">
              <div className="overflow-hidden rounded-[1.25rem] bg-black">
                <video controls playsInline preload="metadata" className="aspect-video w-full">
                  <source src="/demo/film.mp4" type="video/mp4" />
                  <track kind="captions" src="/demo/captions.vtt" srcLang="en" label="English" default />
                </video>
              </div>
            </div>
          </div>
        </section>

        {/* real frames */}
        <section className="mt-20">
          <h2 className="text-center font-display text-4xl text-peach">Not mockups</h2>
          <p className="mt-3 text-center text-sm text-mist/70">
            Every image below is a frame from the real render or a real generated card.
          </p>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {SHOTS.map((shot) => (
              <figure key={shot.src}
                className="group overflow-hidden rounded-2xl border border-mist/15 bg-white/[0.04] backdrop-blur
                           transition hover:border-peach/40">
                <div className="relative aspect-[16/10] bg-black/60">
                  <Image src={shot.src} alt={shot.title} fill
                    sizes="(max-width:640px) 100vw, 33vw" className="object-contain" />
                </div>
                <figcaption className="p-5">
                  <p className="font-mono text-[10px] tracking-[0.2em] text-coral/90">{shot.tag}</p>
                  <h3 className="mt-2 font-display text-xl leading-snug text-parchment">{shot.title}</h3>
                  <p className="mt-2 text-[13px] leading-snug text-mist/70">{shot.body}</p>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        {/* all 33 */}
        <section className="mt-20">
          <h2 className="text-center font-display text-4xl text-peach">All 33 features</h2>
          <div className="mt-10 space-y-3">
            {SECTIONS.map((s) => (
              <div key={s.n}
                className="flex flex-col gap-2 rounded-2xl border border-mist/15 bg-white/[0.04] p-5 backdrop-blur sm:flex-row sm:items-center sm:gap-6">
                <div className="flex items-center gap-3 sm:w-64 sm:shrink-0">
                  <span className="rounded-full bg-coral/20 px-2.5 py-1 font-mono text-[11px] text-coral">
                    {s.count}
                  </span>
                  <h3 className="font-display text-lg text-parchment">{s.n}</h3>
                </div>
                <p className="text-[13px] leading-snug text-mist/70">{s.line}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-20 text-center">
          <div className="flex flex-wrap justify-center gap-3">
            <a href="/try"
              className="rounded-xl bg-coral px-6 py-3 text-sm font-medium text-night
                         shadow-[0_0_32px_-6px_rgba(239,109,91,0.8)] hover:brightness-110">
              Try it yourself
            </a>
            <a href="/jar"
              className="rounded-xl border border-mist/20 bg-white/[0.05] px-6 py-3 text-sm font-medium text-parchment hover:border-mist/40">
              Open the Memory Jar
            </a>
            <a href="/showcase"
              className="rounded-xl border border-mist/20 bg-white/[0.05] px-6 py-3 text-sm font-medium text-parchment hover:border-mist/40">
              Live capability report
            </a>
          </div>
          <p className="mx-auto mt-8 max-w-xl text-[11px] leading-snug text-mist/50">
            Built on Backblaze B2 and Genblaze. Provenance sealed under Object Lock with
            COMPLIANCE retention; per-scene disclosure in the EU AI Act Article 50
            vocabulary, enforceable 2 August 2026.
          </p>
        </section>
      </div>
    </main>
  );
}
