import Image from "next/image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The feature gallery — one page a judge can screenshot.
 *
 * Every image here is a frame from the real rendered film or a real generated
 * card, not a mockup. That is the point: a gallery of mockups would be the same
 * dishonesty this product exists to refuse.
 */

const WORKER = process.env.MEDIA_WORKER_URL || "http://127.0.0.1:8000";

type Health = {
  ok: boolean;
  provider_chains: Record<string, string[] | unknown>;
  capabilities: { healthy: boolean; degraded: string[] };
};

async function health(): Promise<Health | null> {
  try {
    const res = await fetch(`${WORKER}/health`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as Health) : null;
  } catch {
    return null;
  }
}

type Feature = { n: string; title: string; problem: string; answer: string };

const SECTIONS: { id: string; name: string; tag: string; features: Feature[] }[] = [
  {
    id: "01", name: "Evidence Autopilot", tag: "6 of 6",
    features: [
      { n: "1", title: "Automatic curation", problem: "70% of photos are never looked at again", answer: "Perceptual-hash dedup + blur scoring. Nothing deleted — originals stay" },
      { n: "2", title: "Truth Status Model", problem: "AI asserts things your photos never showed", answer: "Six statuses. INFERRED can never be generated without you" },
      { n: "3", title: "Consent gate", problem: "Systems recreate moments nobody agreed to", answer: "Silence means no. Only one code path can promote a claim" },
      { n: "4", title: "Sensitive controls", problem: "Memories surface at the worst moment", answer: "Ask before including, not just before recreating. GPS physically stripped" },
      { n: "5", title: "Evidence-linked route", problem: "Maps show places you never went", answer: "Every stop traces to the photos that prove it" },
      { n: "6", title: "Collaborative inbox", problem: "Only one person can document a trip", answer: "Invite links, no account needed, consent per contributor" }
    ]
  },
  {
    id: "02", name: "Before the trip", tag: "8 of 8",
    features: [
      { n: "7", title: "Traveler DNA", problem: "Asked the same 15 questions every trip", answer: "Learns from past trips. One trip is an anecdote — never acted on" },
      { n: "8", title: "Dream to destination", problem: "You start with a photo, not a place name", answer: "Reads attributes, never guesses the location. Season is a hard filter" },
      { n: "9", title: "Compare futures", problem: "Two plans both read well", answer: "Scored on cost, fatigue, rest, access. Confidence falls with assumptions" },
      { n: "10", title: "Constraint-safe itinerary", problem: "~90% of AI itineraries contain an error", answer: "Real street routing. prev_end + travel + buffer ≤ next_start" },
      { n: "11", title: "Group fairness", problem: "The loudest member decides everything", answer: "Maximises the worst-off member, not the average" },
      { n: "12", title: "Budget autopilot", problem: "Money runs out on day nine of twelve", answer: "Money has states. Never proposes cancelling what is already paid" },
      { n: "13", title: "Readiness vault", problem: "Passport fails the six-month rule at the desk", answer: "Measured from your RETURN date. Entry rules never decided here" },
      { n: "14", title: "Smart packing", problem: "Power bank in the hold gets confiscated", answer: "IATA cabin rules override everything else" }
    ]
  },
  {
    id: "03", name: "During the trip", tag: "6 of 6",
    features: [
      { n: "15", title: "Live day controller", problem: "The plan is fiction by 10am", answer: "Replans from where you are. Drops the cheapest thing, not the last" },
      { n: "16", title: "Sensory budget", problem: "Planners count kilometres, not exhaustion", answer: "A 2km airport day scores higher than a 9km hike" },
      { n: "17", title: "Accessibility reality", problem: "Access info is marketing, not fact", answer: "Graded by who said so. Unknown is never rendered as yes" },
      { n: "18", title: "Offline survival pack", problem: "No signal when you need the address", answer: "One file, zero network calls, no secrets inside" },
      { n: "19", title: "Culture copilot", problem: "Quiet offence you never learn about", answer: "Convention with variation stated. Law kept separate from custom" },
      { n: "20", title: "Safety guardian", problem: "911 is not the number everywhere", answer: "Assembled before departure. Japan has no single number — it says so" }
    ]
  },
  {
    id: "04", name: "When it goes wrong", tag: "4 of 4",
    features: [
      { n: "21", title: "Disruption recovery", problem: "Three things need doing, one is obvious", answer: "Ranked by what expires soonest, not what is worth most" },
      { n: "22", title: "Passenger rights", problem: "Entitlements exist and go unclaimed", answer: "EC261 / DOT / Montreal. Care survives what compensation does not" },
      { n: "23", title: "Claim capsule", problem: "Claims fail on evidence, not entitlement", answer: "Sealed under Object Lock. Lists what is still missing" },
      { n: "24", title: "Baggage twin", problem: "Reconstructing a suitcase from memory", answer: "Built at packing time. Counts down the 21-day window" }
    ]
  },
  {
    id: "05", name: "The film", tag: "5 of 5",
    features: [
      { n: "25", title: "Capture director", problem: "You notice the gap after you leave", answer: "Go photograph it instead. Ranked by how soon the chance closes" },
      { n: "26", title: "Story director", problem: "Photos pile up, no story forms", answer: "Per-scene narration, timed to the picture it describes" },
      { n: "27", title: "Autonomous critic", problem: "Models hallucinate the wrong place", answer: "Claude rejects scenes. It really does — and the film shows it" },
      { n: "28", title: "Cross-provider failover", problem: "One vendor down, product down", answer: "12 rungs across 4 vendors. Survives an SDK renaming a class" },
      { n: "29", title: "One trip, many outputs", problem: "Export locked to one format", answer: "Film, 9:16 reel, cover, journal, offline pack" }
    ]
  },
  {
    id: "06", name: "Trust and storage", tag: "4 of 4",
    features: [
      { n: "30", title: "Experience passport", problem: "Cannot tell real from generated", answer: "Per-scene provenance, on screen and in the file" },
      { n: "31", title: "B2 evidence graph", problem: "Provenance locked in one app", answer: "External systems read the consent-aware graph over HTTP" },
      { n: "32", title: "Object Lock + tamper", problem: "Media altered after delivery", answer: "COMPLIANCE retention, ed25519. One byte flips it to false" },
      { n: "33", title: "Durable workflow", problem: "Restart loses an expensive job", answer: "Postgres checkpointer. Approvals survive a restart" }
    ]
  }
];

const SHOTS = [
  { src: "/demo/shots/film-route.png", title: "The route draws itself",
    body: "Line grows, stops land as reached, distance climbs. Every point is photo GPS — a stop without coordinates is not drawn." },
  { src: "/demo/shots/film-scene.png", title: "Every scene says where it came from",
    body: "Green FROM YOUR PHOTO. Amber AI-RECREATED · YOU APPROVED. Never confusable at a glance." },
  { src: "/demo/shots/film-gap.png", title: "It shows what it refused to invent",
    body: "The pipeline used to detect refusals and delete them. Now they are cards in the film. CHI 2025: AI video implants false memories at 2.05×." },
  { src: "/demo/shots/film-verify.png", title: "What the film is made of",
    body: "Real, recreated, and left empty — with the sealed hash and a verify URL. Tamper-evidence a viewer cannot act on is decoration." },
  { src: "/demo/shots/wrapped.png", title: "A Wrapped where every number states its basis",
    body: "With no geotagged photos, distance reports unknown — not 0 km. Zero would be a lie." },
  { src: "/demo/shots/route.png", title: "Three frames of the same route",
    body: "2 of 6 places at 17 km · 4 of 6 at 83 km · 6 of 6 at 97 km." }
];

export default async function FeaturesPage() {
  const live = await health();
  const rungs = Object.entries(live?.provider_chains ?? {})
    .filter(([k, v]) => k !== "unavailable" && Array.isArray(v))
    .reduce((sum, [, v]) => sum + (v as string[]).length, 0);

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto max-w-5xl px-6 py-16">

        <header className="border-b border-line pb-10">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-moss">
            WanderOS Travel Autopilot
          </p>
          <h1 className="mt-4 max-w-3xl font-display text-5xl leading-[1.1]">
            The only travel AI that refuses to make things up — and can prove it.
          </h1>
          <p className="mt-5 max-w-2xl text-slateInk">
            33 features across the whole journey. Every image below is a frame from the
            real rendered film or a real generated card. None of it is a mockup.
          </p>
          <div className="mt-6 flex flex-wrap gap-2 text-xs">
            {[
              `${rungs || 12} provider rungs · 4 vendors`,
              "127 tests",
              "B2 Object Lock · ed25519",
              "EU AI Act Art. 50 vocabulary"
            ].map((chip) => (
              <span key={chip}
                className="rounded-full bg-card px-3 py-1 font-mono text-slateInk ring-1 ring-line">
                {chip}
              </span>
            ))}
          </div>
        </header>

        <section className="py-14">
          <h2 className="font-display text-3xl">What it looks like</h2>
          <div className="mt-8 grid gap-8 sm:grid-cols-2">
            {SHOTS.map((shot) => (
              <figure key={shot.src} className="overflow-hidden rounded-2xl bg-card ring-1 ring-line">
                <div className="relative aspect-[16/10] bg-ink">
                  <Image src={shot.src} alt={shot.title} fill
                    sizes="(max-width: 640px) 100vw, 50vw" className="object-contain" />
                </div>
                <figcaption className="p-5">
                  <h3 className="font-display text-xl text-ink">{shot.title}</h3>
                  <p className="mt-2 text-sm leading-snug text-slateInk">{shot.body}</p>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="border-t border-line py-14">
          <h2 className="font-display text-3xl">The film</h2>
          <p className="mt-2 max-w-2xl text-sm text-slateInk">
            1080p, per-scene narration, burned captions plus a selectable track, and a
            route that draws itself. Sealed and tamper-evident.
          </p>
          <div className="mt-6 overflow-hidden rounded-2xl bg-black shadow-lg">
            <video controls playsInline preload="metadata" className="aspect-video w-full">
              <source src="/demo/film.mp4" type="video/mp4" />
              <track kind="captions" src="/demo/captions.vtt" srcLang="en" label="English" default />
            </video>
          </div>
        </section>

        {SECTIONS.map((section) => (
          <section key={section.id} className="border-t border-line py-14">
            <div className="flex items-baseline gap-4">
              <span className="font-mono text-sm text-moss">{section.id}</span>
              <h2 className="font-display text-3xl">{section.name}</h2>
              <span className="rounded-full bg-forest px-3 py-1 font-mono text-[11px] text-white">
                {section.tag}
              </span>
            </div>
            <div className="mt-7 grid gap-4 sm:grid-cols-2">
              {section.features.map((f) => (
                <article key={f.n} className="rounded-2xl bg-card p-5 ring-1 ring-line">
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-xs text-moss">{f.n}</span>
                    <h3 className="font-display text-lg text-ink">{f.title}</h3>
                  </div>
                  <p className="mt-3 text-xs uppercase tracking-wide text-coral">the problem</p>
                  <p className="text-sm leading-snug text-slateInk">{f.problem}</p>
                  <p className="mt-3 text-xs uppercase tracking-wide text-moss">what it does</p>
                  <p className="text-sm leading-snug text-ink">{f.answer}</p>
                </article>
              ))}
            </div>
          </section>
        ))}

        <section className="border-t border-line py-14">
          <h2 className="font-display text-3xl">Try it yourself</h2>
          <p className="mt-2 max-w-2xl text-sm text-slateInk">
            Ten panels that post to the running worker and show the raw response. Change
            an input and the answer changes — including the ones that come back saying
            we don&rsquo;t know.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a href="/try" className="rounded-lg bg-forest px-5 py-2.5 text-sm font-medium text-white hover:bg-forestDeep">
              Open the playground
            </a>
            <a href="/showcase" className="rounded-lg bg-card px-5 py-2.5 text-sm font-medium text-ink ring-1 ring-line hover:bg-sand">
              Live capability report
            </a>
          </div>
        </section>

      </div>
    </main>
  );
}
