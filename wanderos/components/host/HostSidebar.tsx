"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, PlusCircle, CalendarCheck, Wallet, MessageSquare, Settings, Sparkles } from "lucide-react";

/** Premium left nav for the host workspace (travelmate-style), in WanderOS's palette. Built items are
 *  links; not-yet-built sections (bookings/earnings/etc.) are shown dimmed as "soon". */
const NAV = [
  { label: "Dashboard", href: "/host/dashboard", icon: LayoutDashboard, ready: true },
  { label: "New Listing", href: "/host/listings/new", icon: PlusCircle, ready: true },
  { label: "Bookings", href: "/host/bookings", icon: CalendarCheck, ready: true },
  { label: "Earnings", href: "/host/earnings", icon: Wallet, ready: true },
  { label: "Messages", href: "/host/messages", icon: MessageSquare, ready: false },
  { label: "Settings", href: "/host/settings", icon: Settings, ready: false }
];

export function HostSidebar({ hostName }: { hostName: string }) {
  const path = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-white/10 bg-black/30 backdrop-blur-2xl lg:flex">
      <div className="flex items-center gap-3 border-b border-white/10 px-6 py-5">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-coral to-mist text-lg font-black text-night">W</span>
        <div>
          <p className="font-semibold">WanderOS</p>
          <p className="text-xs text-white/50">Host workspace</p>
        </div>
      </div>

      <div className="flex items-center gap-3 border-b border-white/10 px-6 py-5">
        <div className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-coral to-mist text-lg font-bold text-night">
          {(hostName || "H").slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate font-semibold">{hostName || "Host"}</p>
          <p className="text-xs text-aurora">● Online</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1.5 px-3 py-5">
        {NAV.map(({ label, href, icon: Icon, ready }) => {
          const active = path === href || (href !== "/host/dashboard" && path.startsWith(href));
          if (!ready)
            return (
              <span key={label} className="flex cursor-not-allowed items-center gap-3 rounded-xl px-4 py-3 text-sm text-white/35">
                <Icon size={18} /> {label} <span className="ml-auto text-[10px] uppercase tracking-wider text-white/25">soon</span>
              </span>
            );
          return (
            <Link
              key={label}
              href={href}
              className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition ${
                active ? "bg-gradient-to-r from-coral to-mist text-night shadow-coral" : "text-white/75 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon size={18} /> {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-3">
        <Link
          href="/host/listings/new"
          className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-coral to-mist px-4 py-3 text-sm font-semibold text-night shadow-coral transition hover:brightness-110"
        >
          <Sparkles size={16} /> Create listing
        </Link>
      </div>
    </aside>
  );
}
