import Link from "next/link";

type LoginPageProps = {
  searchParams?: Promise<{ next?: string; error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = params?.next && params.next.startsWith("/") ? params.next : "";
  const error = params?.error || "";

  return (
    <main className="relative min-h-screen overflow-hidden text-[#17211f] [color-scheme:light]">
      {/* The 61MB 4K source takes a moment on first load, and *.mp4 is gitignored
          so a fresh clone has no video at all. The poster keeps the hero looking
          finished either way instead of rendering as blank white. */}
      <video
        className="absolute inset-0 h-full w-full object-cover brightness-[1.05] contrast-[1.08] saturate-[1.18]"
        src="/videos/paris-hero.mp4"
        poster="/images/traveler-dashboard/city.jpg"
        autoPlay
        muted
        loop
        playsInline
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,.45),rgba(255,255,255,.16)_50%,rgba(13,19,17,.14))]" />
      <div className="absolute inset-x-0 bottom-0 h-52 bg-[linear-gradient(0deg,rgba(255,255,255,.48),transparent)]" />

      <section className="relative grid min-h-screen items-center gap-10 px-6 py-10 lg:grid-cols-[minmax(0,1fr)_520px] lg:px-10">
        <div className="hidden max-w-4xl lg:block">
          <p className="text-xs font-black uppercase tracking-[0.34em] text-[#8a4d3f]">WanderOS</p>
          <h1 className="mt-5 max-w-4xl text-6xl font-black leading-[0.96] tracking-tight text-[#101a17] drop-shadow-[0_1px_0_rgba(255,255,255,.58)] xl:text-7xl">
            Travel intelligence that ends in a living memory.
          </h1>
          <p className="mt-7 max-w-2xl text-xl font-medium leading-9 text-[#26342f] drop-shadow-[0_1px_0_rgba(255,255,255,.45)]">
            Multi-agent planning, host matching, browser research, and cinematic Memory Jars in one shipped product.
          </p>
        </div>

        <div className="w-full rounded-[8px] border border-white/80 bg-white/74 p-7 shadow-[0_28px_90px_rgba(12,20,17,.28)] backdrop-blur-2xl">
          <div className="mb-6 h-1 w-16 rounded-full bg-[#d05a4e]" />
          <p className="text-xs font-black uppercase tracking-[0.28em] text-[#8a4d3f]">Secure workspace</p>
          <h2 className="mt-2 text-4xl font-black tracking-tight text-[#101a17]">Sign in to WanderOS</h2>
          <p className="mt-2 text-sm leading-6 text-[#52615d]">Access your traveler, host, or admin workspace with role-based protection and user-owned data.</p>
          {error ? (
            <div className="mt-4 rounded-[8px] border border-[#d05a4e]/30 bg-[#fff1ee] px-3 py-2 text-sm font-semibold text-[#9f2f25]">
              {error}
            </div>
          ) : null}

          <form action="/api/auth/login" method="post" className="mt-6 grid gap-3">
            <input type="hidden" name="next" value={next} />
            <label>
              <span className="text-xs font-semibold text-[#52615d]">Email</span>
              <input name="email" type="email" required className="auth-field mt-1 w-full rounded-[8px] border border-[#d8ccc4] px-3 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,.8)] outline-none transition focus:border-[#d05a4e] focus:ring-4 focus:ring-[#d05a4e]/12" />
            </label>
            <label>
              <span className="text-xs font-semibold text-[#52615d]">Password</span>
              <input name="password" type="password" required className="auth-field mt-1 w-full rounded-[8px] border border-[#d8ccc4] px-3 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,.8)] outline-none transition focus:border-[#d05a4e] focus:ring-4 focus:ring-[#d05a4e]/12" />
            </label>
            <button className="rounded-[8px] bg-[#111b18] px-4 py-3.5 text-sm font-bold text-white shadow-[0_16px_34px_rgba(17,27,24,.26)] transition hover:bg-[#24332f]">
              Sign In
            </button>
          </form>

          <div className="my-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-xs font-bold uppercase tracking-[0.18em] text-[#7b8783]">
            <span className="h-px bg-[#cfc5bc]" />
            <span>or</span>
            <span className="h-px bg-[#cfc5bc]" />
          </div>

          <Link href="/api/auth/google" className="flex items-center justify-center rounded-[8px] border border-[#d8ccc4] bg-white px-4 py-3.5 text-sm font-bold text-[#17211f] shadow-[0_10px_24px_rgba(17,27,24,.08)] transition hover:border-[#d05a4e]">
            Continue with Google
          </Link>

          <div className="mt-6 flex items-center justify-between border-t border-[#cfc5bc] pt-5 text-sm">
            <span className="font-medium text-[#65736f]">New to WanderOS?</span>
            <Link href="/register" className="font-semibold text-[#17211f] underline-offset-4 hover:underline">
              Create account
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
