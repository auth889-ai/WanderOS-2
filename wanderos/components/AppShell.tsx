import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { Role } from "@/lib/auth/roles";
import { TravelerDashboardBackground } from "@/components/traveler/TravelerDashboardBackground";

const navByRole: Record<Role, Array<[string, string]>> = {
  traveler: [
    ["Dashboard", "/dashboard"],
    ["Autopilot", "/memory/new"],
    ["Explore", "/marketplace"],
    ["Trips", "/trips"],
    ["Discover", "/discover"],
    ["Feed", "/feed"],
    ["Memory Books", "/memory-books"],
    ["Memory Jar", "/memory-jars"]
  ],
  host: [
    ["Dashboard", "/host/dashboard"],
    ["Create Listing", "/host/listings/new"]
  ],
  admin: [["Admin", "/admin"]]
};

export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const nav = session ? navByRole[session.role] : [];
  const homeHref = session?.role === "host" ? "/host/dashboard" : session?.role === "admin" ? "/admin" : "/dashboard";
  const isTraveler = session?.role === "traveler";

  return (
    <div className="relative isolate min-h-screen overflow-hidden bg-black text-white">
      <div className="pointer-events-none fixed inset-0 z-0">
        {isTraveler ? (
          <TravelerDashboardBackground />
        ) : (
          <>
            <video className="h-full w-full object-cover opacity-20" src="/videos/paris-hero.mp4" autoPlay muted loop playsInline />
            <div className="absolute inset-0 bg-[linear-gradient(145deg,rgba(18,14,24,.96),rgba(38,24,28,.92)_48%,rgba(12,18,19,.96))]" />
          </>
        )}
      </div>
      <header className="sticky top-0 z-30 border-b border-white/10 bg-black/35 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <Link href={homeHref} className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-[8px] border border-white/14 bg-white/10 text-sm font-black">W</span>
            <span>
              <strong className="block text-sm">WanderOS</strong>
              <span className="block text-[11px] text-white/48">
                {session ? `${session.role} workspace` : "multi-agent travel memory system"}
              </span>
            </span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {nav.map(([label, href]) => (
              <Link key={href} href={href} className="rounded-[8px] px-3 py-2 text-sm text-white/68 transition hover:bg-white/10 hover:text-white">
                {label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {session ? (
              <>
                <span className="hidden rounded-[8px] border border-white/12 bg-white/8 px-3 py-2 text-xs font-semibold capitalize text-white/72 sm:inline">
                  {session.name}
                </span>
                <Link href="/api/auth/logout" className="rounded-[8px] bg-white px-4 py-2 text-sm font-semibold text-night">
                  Logout
                </Link>
              </>
            ) : (
              <Link href="/login" className="rounded-[8px] bg-white px-4 py-2 text-sm font-semibold text-night">
                Demo Login
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="relative z-10 mx-auto max-w-7xl px-5 py-7">{children}</main>
    </div>
  );
}
