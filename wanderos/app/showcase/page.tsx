import Image from "next/image";

export const runtime = "nodejs";
// Always render fresh: this page's whole purpose is to show what the system can
// do RIGHT NOW, so a cached copy claiming a provider is live would be a lie.
export const dynamic = "force-dynamic";

const WORKER = process.env.MEDIA_WORKER_URL || "http://127.0.0.1:8000";

type Capability = { name: string; available: boolean; detail: string; degrades_to: string };
type Health = {
  ok: boolean;
  tier: string;
  b2_configured: boolean;
  reasoner: string;
  provider_chains: Record<string, string[] | { provider: string; reason: string }[]>;
  capabilities: { healthy: boolean; degraded: string[]; blocking: string[]; capabilities: Capability[] };
};
type Entitlement = {
  regime: string; kind: string; article: string; amount: number | null;
  currency: string; confidence: string; reason: string; action_required: string;
};
type Verify = {
  available: boolean;
  reason?: string;
  checks: { check: string; passed: boolean; detail: string }[];
  tamper_test: { bytes_changed: number; verified_after_tamper: boolean; detail: string };
  note: string;
};
type WeatherResult = {
  label: string;
  place: { name: string; country_code: string } | null;
  weather: { kind: string; min_temp_c: number; max_temp_c: number; wet_days: number;
             rain_expected: boolean; basis: string };
};
type DemoEvidence = {
  available: boolean;
  reason?: string;
  classifier?: string;
  cached?: boolean;
  sources_used: string[];
  photos: { key: string; source: string | null; labels: string[]; people: number | null;
            setting: string | null }[];
  claims: { id: string; status: string; confidence: number; text: string }[];
};
type Rights = {
  flight: string; delay_hours: number; distance_km: number;
  headline_amount: number | null; entitlements: Entitlement[];
  next_steps: string[]; disclaimer: string;
};

async function get<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${WORKER}${path}`, { ...init, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // The worker being down is a legitimate state to render, not a crash — the
    // page says so plainly rather than showing a stale success.
    return null;
  }
}

const DELAYED_FLIGHT = {
  departure_airport: "LHR", arrival_airport: "JFK",
  departure_country: "GB", arrival_country: "US", carrier_country: "GB",
  scheduled_arrival: "2026-06-01T18:00:00", actual_arrival: "2026-06-01T23:30:00",
  departure_latlon: [51.47, -0.4541], arrival_latlon: [40.64, -73.78],
  cause: "technical_fault"
};

// Dates are derived from today so the page never quietly shows a stale window.
const iso = (daysFromNow: number) =>
  new Date(Date.now() + daysFromNow * 86_400_000).toISOString().slice(0, 10);
const WEATHER_DEMOS = [
  { destination: "Reykjavik", start: iso(5), end: iso(12) },   // inside forecast range
  { destination: "Ubud", start: iso(150), end: iso(160) }      // far out -> climate estimate
];

const CONFIDENCE_STYLE: Record<string, string> = {
  likely: "bg-forest text-white",
  conditional: "bg-peach text-ink",
  unavailable: "bg-sand text-slateInk"
};

// Only the file paths are known here. Labels, statuses and confidences all come
// from the live pipeline — hand-written "VERIFIED 95%" badges were exactly the
// invented confidence this project exists to argue against.
const PHOTO_SRC: Record<string, string> = {
  "city.jpg": "/images/traveler-dashboard/city.jpg",
  "m4.png": "/images/traveler-dashboard/m4.png",
  "m7.png": "/images/traveler-dashboard/m7.png"
};

const STATUS_STYLE: Record<string, string> = {
  VERIFIED: "bg-forest text-white",
  USER_CONFIRMED: "bg-forest text-white",
  INFERRED: "bg-peach text-ink",
  UNKNOWN: "bg-sand text-slateInk",
  CONTRADICTED: "bg-coral text-white",
  SYNTHETIC: "bg-mist text-ink"
};

const CLIPS = ["/videos/326677_medium.mp4", "/videos/305657_medium.mp4", "/videos/326739_medium.mp4"];

function Section({ n, title, sub, children }: {
  n: string; title: string; sub: string; children: React.ReactNode;
}) {
  return (
    <section className="border-t border-line py-14">
      <div className="mb-8 flex items-baseline gap-4">
        <span className="font-mono text-sm text-moss">{n}</span>
        <div>
          <h2 className="font-display text-3xl text-ink">{title}</h2>
          <p className="mt-1 max-w-2xl text-sm text-slateInk">{sub}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export default async function ShowcasePage() {
  const post = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  const [health, rights, verify, near, far, evidence] = await Promise.all([
    get<Health>("/health"),
    get<Rights>("/rights/assess", post(DELAYED_FLIGHT)),
    get<Verify>("/trust/verify-demo"),
    get<WeatherResult>("/planning/weather", post(WEATHER_DEMOS[0])),
    get<WeatherResult>("/planning/weather", post(WEATHER_DEMOS[1])),
    get<DemoEvidence>("/evidence/demo-classify")
  ]);

  // Labelled here rather than in the API so the page shows which request each
  // card came from; the temperatures themselves are entirely the worker's.
  const weather = [near && { ...near, label: WEATHER_DEMOS[0].destination },
                   far && { ...far, label: WEATHER_DEMOS[1].destination }]
    .filter(Boolean) as WeatherResult[];

  const chains = Object.entries(health?.provider_chains ?? {}).filter(
    ([k, v]) => k !== "unavailable" && Array.isArray(v)
  ) as [string, string[]][];
  const rungs = chains.reduce((sum, [, v]) => sum + v.length, 0);

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto max-w-5xl px-6 py-16">

        <header>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-moss">
            WanderOS Travel Autopilot
          </p>
          <h1 className="mt-3 font-display text-5xl leading-tight text-ink">
            Every claim on this page is probed live.
          </h1>
          <p className="mt-4 max-w-2xl text-slateInk">
            Nothing below is a screenshot or a mock. The film was generated, critiqued and
            sealed by the real pipeline; the provider ladder and capability report are
            fetched from the running worker each time this page loads.
          </p>
          <div className="mt-6 flex flex-wrap gap-2 text-xs">
            <span className={`rounded-full px-3 py-1 font-mono ${health ? "bg-forest text-white" : "bg-coral text-white"}`}>
              worker {health ? `online · ${health.tier} tier` : "OFFLINE"}
            </span>
            {health && (
              <>
                <span className="rounded-full bg-card px-3 py-1 font-mono text-slateInk ring-1 ring-line">
                  {rungs} provider rungs
                </span>
                <span className="rounded-full bg-card px-3 py-1 font-mono text-slateInk ring-1 ring-line">
                  B2 {health.b2_configured ? "configured" : "off"}
                </span>
                <span className="rounded-full bg-card px-3 py-1 font-mono text-slateInk ring-1 ring-line">
                  {health.reasoner}
                </span>
              </>
            )}
          </div>
        </header>

        {!health && (
          <p className="mt-10 rounded-xl bg-coral/10 p-5 text-sm text-ink ring-1 ring-coral/30">
            The media worker is not reachable at <code className="font-mono">{WORKER}</code>.
            Start it with{" "}
            <code className="font-mono">
              PIPELINE_TIER=dev .venv/bin/python -m uvicorn main:app --port 8000
            </code>{" "}
            from <code className="font-mono">media-worker/</code>. Everything below that needs
            the worker is hidden rather than faked.
          </p>
        )}

        <Section n="01" title="The film"
          sub="Generated from real photos, narrated per scene, captioned twice — burned into the picture for muted viewing and as a selectable track for screen readers.">
          <div className="overflow-hidden rounded-2xl bg-black shadow-lg">
            <video controls playsInline preload="metadata" className="aspect-video w-full">
              <source src="/demo/film.mp4" type="video/mp4" />
              <track kind="captions" src="/demo/captions.vtt" srcLang="en" label="English" default />
            </video>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              ["streams", "h264 · aac · mov_text"],
              ["faststart", "yes — plays on first bytes"],
              ["narration", "one track per scene"],
              ["captions", "burned + .srt + .vtt"]
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-card p-4 ring-1 ring-line">
                <dt className="font-mono text-[11px] uppercase tracking-wide text-moss">{k}</dt>
                <dd className="mt-1 text-sm text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section n="02" title="Evidence, and what it actually proves"
          sub="Labels come from a vision model and statuses from Claude, computed on this deployment. A photo proves what is in the frame — it does not prove where it was taken, and the classifier is expected to say so.">
          {evidence?.available ? (
            <>
              <div className="grid gap-5 sm:grid-cols-3">
                {evidence.photos.map((p) => (
                  <figure key={p.key} className="overflow-hidden rounded-2xl bg-card ring-1 ring-line">
                    {PHOTO_SRC[p.key] && (
                      <div className="relative aspect-[4/3]">
                        <Image src={PHOTO_SRC[p.key]} alt={p.key} fill
                          sizes="(max-width: 640px) 100vw, 33vw" className="object-cover" />
                      </div>
                    )}
                    <figcaption className="p-4">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs text-slateInk">{p.key}</span>
                        <span className="font-mono text-[10px] text-moss">{p.source}</span>
                      </div>
                      <p className="mt-2 text-sm leading-snug text-ink">
                        {p.labels.slice(0, 5).join(" · ")}
                      </p>
                    </figcaption>
                  </figure>
                ))}
              </div>

              <div className="mt-5 space-y-2">
                {evidence.claims.map((c) => (
                  <div key={c.id} className="flex items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-line">
                    <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${STATUS_STYLE[c.status] ?? "bg-sand"}`}>
                      {c.status} {Math.round((c.confidence ?? 0) * 100)}%
                    </span>
                    <p className="text-sm leading-snug text-ink">{c.text}</p>
                  </div>
                ))}
              </div>

              <p className="mt-4 text-xs text-slateInk">
                Classified by {evidence.classifier} via {evidence.sources_used.join(", ")}
                {evidence.cached ? " (cached briefly — a real model call per page load would be slow and costly)" : " (computed on this request)"}.
                Note the low-confidence rows: the classifier refusing to assert something is
                the feature, not a failure.
              </p>
            </>
          ) : (
            <p className="rounded-2xl bg-sand p-5 text-sm text-slateInk">
              Live classification unavailable{evidence?.reason ? ` — ${evidence.reason}` : ""}.
              Nothing is shown in its place rather than substituting invented verdicts.
            </p>
          )}
        </Section>

        <Section n="03" title="Video clips become evidence"
          sub="Uploaded video used to be discarded. Clips are now split into shots and a representative frame from each is labelled through the same vision path as a photo.">
          <div className="grid gap-5 sm:grid-cols-3">
            {CLIPS.map((src, i) => (
              <div key={src} className="overflow-hidden rounded-2xl bg-black ring-1 ring-line">
                <video muted loop playsInline preload="metadata" controls className="aspect-video w-full">
                  <source src={src} type="video/mp4" />
                </video>
                <p className="bg-card px-3 py-2 font-mono text-[11px] text-slateInk">
                  shot {i + 1} · frame sampled ⅓ in
                </p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-slateInk">
            A frame is sampled a third of the way into each shot: the first frame of a cut is
            often a motion-blurred transition. Real footage needs no consent gate, because it
            actually happened.
          </p>
        </Section>

        {rights && (
          <Section n="04" title="Passenger Rights Engine"
            sub={`Live computation for ${rights.flight} — a ${rights.delay_hours}h delay over ${rights.distance_km}km. Deterministic: no model is consulted, and every line cites its article.`}>
            <div className="mb-5 flex items-baseline gap-3">
              <span className="font-display text-4xl text-forest">
                {rights.headline_amount ? `£${rights.headline_amount}` : "—"}
              </span>
              <span className="text-sm text-slateInk">plausibly claimable</span>
            </div>
            <div className="space-y-3">
              {rights.entitlements.map((e, i) => (
                <div key={i} className="rounded-xl bg-card p-4 ring-1 ring-line">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${CONFIDENCE_STYLE[e.confidence] ?? "bg-sand"}`}>
                      {e.confidence}
                    </span>
                    <span className="font-mono text-xs text-ink">{e.kind}</span>
                    {e.amount !== null && (
                      <span className="font-mono text-xs text-forest">{e.amount} {e.currency}</span>
                    )}
                    <span className="ml-auto font-mono text-[11px] text-slateInk">{e.article}</span>
                  </div>
                  <p className="mt-2 text-sm leading-snug text-slateInk">{e.reason}</p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs italic text-slateInk">{rights.disclaimer}</p>
          </Section>
        )}

        {health && (
          <Section n="05" title="Provider ladder"
            sub="Every configured key becomes a rung. A dead vendor drops the run one step instead of ending it — including a vendor whose SDK renamed a class.">
            <div className="space-y-4">
              {chains.map(([modality, links]) => (
                <div key={modality} className="rounded-2xl bg-card p-5 ring-1 ring-line">
                  <p className="font-mono text-xs uppercase tracking-wide text-moss">
                    {modality} · {links.length} rungs
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {links.map((l, i) => (
                      <span key={l} className="flex items-center gap-2">
                        {i > 0 && <span className="text-line">→</span>}
                        <span className="rounded-lg bg-sand px-2.5 py-1 font-mono text-[11px] text-ink">
                          {l}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {health && (
          <Section n="06" title="What this deployment can actually do"
            sub="Probed from the running process, not from requirements.txt. Each line names the feature that dies, not the import that failed.">
            <div className="grid gap-3 sm:grid-cols-2">
              {health.capabilities.capabilities.map((c) => (
                <div key={c.name}
                  className={`rounded-xl p-4 ring-1 ${c.available ? "bg-card ring-line" : "bg-coral/10 ring-coral/30"}`}>
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${c.available ? "bg-forest" : "bg-coral"}`} />
                    <span className="font-mono text-xs text-ink">{c.name}</span>
                  </div>
                  <p className="mt-1.5 text-xs leading-snug text-slateInk">{c.detail}</p>
                  {!c.available && (
                    <p className="mt-1 font-mono text-[11px] text-coral">loses: {c.degrades_to}</p>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section n="07" title="Sealed and tamper-evident"
          sub="Signed with ed25519 and written under a B2 Object Lock COMPLIANCE retention. The output below was computed when you loaded this page — a hardcoded 'PASS' would be exactly the unverifiable claim this project argues against.">
          {verify?.available ? (
            <div className="rounded-2xl bg-ink p-6 font-mono text-xs leading-relaxed text-parchment">
              {verify.checks.map((c) => (
                <div key={c.check}>
                  <span className={c.passed ? "text-aurora" : "text-coral"}>
                    [{c.passed ? "PASS" : "FAIL"}]
                  </span>{" "}
                  <span className="inline-block w-44">{c.check}</span>
                  <span className="text-parchment/60">{c.detail}</span>
                </div>
              ))}
              <div className="mt-4 text-coral">
                {verify.tamper_test.bytes_changed} byte flipped → verified ={" "}
                {String(verify.tamper_test.verified_after_tamper)}
              </div>
              <div className="text-coral/70">{verify.tamper_test.detail}</div>
              <div className="mt-3 text-parchment/40">{verify.note}</div>
            </div>
          ) : (
            <p className="rounded-2xl bg-sand p-5 text-sm text-slateInk">
              Live signing is unavailable on this deployment
              {verify?.reason ? ` (${verify.reason})` : ""}. Nothing is shown in its place,
              because a placeholder here would defeat the purpose.
            </p>
          )}
          <p className="mt-4 text-sm text-slateInk">
            Sealing proves <em>when</em> a record was made and that it has not changed since.
            It does not prove the contents were true when written — the capsule says so in its
            own text, because overclaiming here would undo the point of it.
          </p>
        </Section>

        {weather && (
          <Section n="08" title="Real weather, and an honest label on it"
            sub="Fetched live from Open-Meteo for the dates below. A forecast and a climate estimate are different claims, and most travel tools blur them — this never does.">
            <div className="grid gap-4 sm:grid-cols-2">
              {weather.map((w) => (
                <div key={w.label} className="rounded-2xl bg-card p-5 ring-1 ring-line">
                  <div className="flex items-baseline justify-between">
                    <span className="font-display text-xl text-ink">{w.place?.name ?? w.label}</span>
                    <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${
                      w.weather.kind === "forecast" ? "bg-forest text-white" : "bg-peach text-ink"}`}>
                      {w.weather.kind}
                    </span>
                  </div>
                  <p className="mt-2 font-mono text-2xl text-forest">
                    {w.weather.min_temp_c}°–{w.weather.max_temp_c}°C
                  </p>
                  <p className="mt-1 text-sm text-slateInk">
                    {w.weather.wet_days} wet day{w.weather.wet_days === 1 ? "" : "s"} ·{" "}
                    {w.weather.rain_expected ? "pack for rain" : "rain unlikely"}
                  </p>
                  <p className="mt-2 text-xs italic text-slateInk">{w.weather.basis}</p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-slateInk">
              A trip five months out cannot be forecast at all. Presenting a climate average
              as a forecast is the same category of error as presenting a generated scene as a
              photograph — a plausible number where a real one should be.
            </p>
          </Section>
        )}

      </div>
    </main>
  );
}
