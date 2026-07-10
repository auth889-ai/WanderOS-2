import { redirect } from "next/navigation";
import { CalendarCheck } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { HostLayout } from "@/components/host/HostLayout";
import { listHostBookings } from "@/lib/services/booking.service";

export const dynamic = "force-dynamic";

const fmt = (n: number) => "৳" + Math.round(n).toLocaleString();
const date = (s: string | null) => (s ? new Date(s).toLocaleDateString("en", { month: "short", day: "numeric" }) : "—");

export default async function HostBookingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "host") redirect("/");

  const bookings = await listHostBookings(session.id);

  return (
    <HostLayout title="Bookings" subtitle={`${bookings.length} confirmed reservation${bookings.length === 1 ? "" : "s"} across your stays.`} hostName={session.name}>
      <div className="space-y-6 text-white">
        {bookings.length ? (
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wider text-white/45">
                  <th className="px-4 py-3 font-medium">Stay</th>
                  <th className="px-4 py-3 font-medium">Guest</th>
                  <th className="px-4 py-3 font-medium">Dates</th>
                  <th className="px-4 py-3 font-medium">Nights · Guests</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Earned</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-3"><p className="font-medium">{b.title}</p><p className="text-xs text-white/40">{b.city}</p></td>
                    <td className="px-4 py-3 text-white/80">{b.traveler_name || "Traveler"}</td>
                    <td className="px-4 py-3 text-white/70">{date(b.check_in)} – {date(b.check_out)}</td>
                    <td className="px-4 py-3 text-white/70">{b.nights} · {b.guests}</td>
                    <td className="px-4 py-3"><span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium capitalize text-emerald-300">{b.status}</span></td>
                    <td className="px-4 py-3 text-right font-semibold text-coral">{fmt(Number(b.total_amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-12 text-center">
            <CalendarCheck className="mx-auto text-white/30" size={32} />
            <p className="mt-3 text-white/60">No bookings yet.</p>
            <p className="text-sm text-white/40">When travelers reserve your stays, they’ll show up here.</p>
          </div>
        )}
      </div>
    </HostLayout>
  );
}
