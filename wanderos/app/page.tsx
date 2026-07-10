import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#120e18] text-white">
      <section className="relative min-h-screen">
        <video
          className="absolute inset-0 h-full w-full object-cover opacity-40"
          src="/videos/paris-hero.mp4"
          autoPlay
          muted
          loop
          playsInline
        />
        <div className="absolute inset-0 bg-[linear-gradient(105deg,rgba(18,14,24,.96),rgba(38,24,28,.78)_46%,rgba(12,18,19,.86))]" />

        <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-[8px] border border-white/18 bg-white/12 text-sm font-black">W</span>
            <span>
              <strong className="block text-sm">WanderOS</strong>
              <span className="block text-[11px] text-white/55">Vercel + AWS Aurora</span>
            </span>
          </div>
          <nav className="flex items-center gap-2">
            <Link href="/login" className="rounded-[8px] border border-white/16 bg-white/8 px-4 py-2 text-sm font-semibold">Log in</Link>
            <Link href="/register" className="rounded-[8px] bg-white px-4 py-2 text-sm font-semibold text-night">Get started</Link>
          </nav>
        </header>

        <div className="relative z-10 mx-auto flex max-w-7xl flex-col justify-center px-6 pt-24">
          <p className="text-xs uppercase tracking-[0.28em] text-peach">Multi-agent travel platform</p>
          <h1 className="mt-5 max-w-3xl text-6xl font-semibold leading-[1.05]">
            Hosts list in minutes. AI does the rest.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-white/64">
            WanderOS turns a host&apos;s photos and notes into a priced, described, and filmed listing — using a
            real multi-agent AI system on Amazon Aurora PostgreSQL.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/register" className="rounded-[8px] bg-gradient-to-r from-peach to-coral px-6 py-3 text-sm font-semibold text-night">
              Become a host
            </Link>
            <Link href="/login" className="rounded-[8px] border border-white/16 bg-white/8 px-6 py-3 text-sm font-semibold">
              Log in
            </Link>
          </div>
          <div className="mt-12 grid max-w-4xl gap-3 sm:grid-cols-3">
            <div className="rounded-[8px] border border-white/14 bg-white/8 p-4 backdrop-blur">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-peach">Track 3</p>
              <p className="mt-2 text-lg font-semibold">Agent Society</p>
              <p className="mt-1 text-sm leading-6 text-white/58">Specialist agents divide vision, pricing, copy, safety, and final composition.</p>
            </div>
            <div className="rounded-[8px] border border-white/14 bg-white/8 p-4 backdrop-blur">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-peach">Negotiation</p>
              <p className="mt-2 text-lg font-semibold">Quality gates settle conflicts</p>
              <p className="mt-1 text-sm leading-6 text-white/58">Facts, safety, and business rules can reject unsupported agent output before save.</p>
            </div>
            <div className="rounded-[8px] border border-white/14 bg-white/8 p-4 backdrop-blur">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-peach">Measured</p>
              <p className="mt-2 text-lg font-semibold">Under 90s target draft</p>
              <p className="mt-1 text-sm leading-6 text-white/58">Aurora logs every agent step for baseline comparisons on latency, quality, and retries.</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
