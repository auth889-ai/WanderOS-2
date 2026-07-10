import Link from "next/link";

/** Premium sticky host topbar (page title + search + New Listing + host avatar) — ported from travelmate. */
export function HostTopbar({ title, subtitle, hostName }: { title: string; subtitle: string; hostName: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-black/25 backdrop-blur-2xl">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">{title}</h1>
          <p className="text-sm text-white/55">{subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            placeholder="Search listings, bookings…"
            className="hidden w-72 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-coral xl:block"
          />
          <Link href="/host/listings/new" className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/15">
            New Listing
          </Link>
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-coral to-mist font-bold text-night">
              {(hostName || "H").slice(0, 1).toUpperCase()}
            </div>
            <div className="hidden sm:block">
              <p className="text-sm font-medium text-white">{hostName || "Host"}</p>
              <p className="text-xs text-white/45">Host account</p>
            </div>
          </div>
          <Link href="/api/auth/logout" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white/80 transition hover:bg-coral/20 hover:text-white">
            Logout
          </Link>
        </div>
      </div>
    </header>
  );
}
