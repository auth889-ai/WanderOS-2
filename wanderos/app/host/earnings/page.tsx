import { redirect } from "next/navigation";
import { Wallet, CalendarCheck, Moon, Users } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { HostLayout } from "@/components/host/HostLayout";
import { hostEarningsSummary, listHostBookings } from "@/lib/services/booking.service";

export const dynamic = "force-dynamic";

const fmt = (n: number) => "৳" + Math.round(n).toLocaleString();

export default async function HostEarningsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "host") redirect("/");

  const [sum, bookings] = await Promise.all([hostEarningsSummary(session.id), listHostBookings(session.id)]);
  const max = Math.max(1, ...sum.monthly.map((m) => m.amount));
  const stats = [
    { label: "Total earnings", value: fmt(sum.total), Icon: Wallet },
    { label: "Bookings", value: String(sum.bookingCount), Icon: CalendarCheck },
    { label: "Nights booked", value: String(sum.nights), Icon: Moon },
    { label: "Guests hosted", value: String(sum.guests), Icon: Users }
  ];

  return (
    <HostLayout title="Earnings" subtitle="Confirmed bookings revenue across all your stays." hostName={session.name}>
      <div className="space-y-6 text-white">
        {/* stat cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-coral/15 text-coral"><s.Icon size={18} /></span>
              <p className="mt-3 text-2xl font-bold">{s.value}</p>
              <p className="text-sm text-white/55">{s.label}</p>
            </div>
          ))}
        </div>

        {/* monthly earnings graph */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
          <p className="mb-5 font-semibold">Monthly earnings</p>
          {sum.monthly.length ? (
            <div className="flex h-56 items-end gap-3">
              {sum.monthly.map((m) => (
                <div key={m.month} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                  <span className="text-[10px] font-medium text-white/55">{fmt(m.amount)}</span>
                  <div className="w-full max-w-[46px] rounded-t-lg bg-gradient-to-t from-coral to-mist shadow-[0_0_24px_rgba(239,109,91,0.35)] transition-all" style={{ height: `${Math.max(3, (m.amount / max) * 86)}%` }} title={`${m.month}: ${fmt(m.amount)} · ${m.bookings} bookings`} />
                  <span className="text-xs text-white/50">{m.month}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-12 text-center text-sm text-white/45">No bookings yet — your earnings graph appears here once travelers book.</p>
          )}
        </div>

        {/* top earning stays + recent bookings */}
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
            <p className="mb-3 font-semibold">Top earning stays</p>
            {sum.byListing.length ? (
              <div className="space-y-2.5">
                {sum.byListing.map((l) => (
                  <div key={l.title} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-white/80">{l.title} <span className="text-white/40">· {l.bookings} bookings</span></span>
                    <span className="whitespace-nowrap font-semibold text-coral">{fmt(l.amount)}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-white/45">No earnings yet.</p>}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
            <p className="mb-3 font-semibold">Recent bookings</p>
            {bookings.length ? (
              <div className="space-y-2">
                {bookings.slice(0, 6).map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{b.title}</p>
                      <p className="text-xs text-white/45">{b.nights} nights · {b.guests} guests{b.check_in ? ` · ${new Date(b.check_in).toLocaleDateString("en", { month: "short", day: "numeric" })}` : ""}</p>
                    </div>
                    <span className="whitespace-nowrap font-semibold text-coral">{fmt(Number(b.total_amount))}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-white/45">No bookings yet.</p>}
          </div>
        </div>
      </div>
    </HostLayout>
  );
}
