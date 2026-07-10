import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, Plus, Sparkles } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { getSession } from "@/lib/auth/session";
import { listTripsForUser } from "@/lib/db/tables/trips";
import { listTravelerBookings } from "@/lib/services/booking.service";

export const dynamic = "force-dynamic";

function formatDate(value: string | null | undefined) {
  if (!value) return "Open dates";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export default async function TripsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "host") redirect("/host/dashboard");
  if (session.role === "admin") redirect("/admin");

  const [trips, bookings] = await Promise.all([
    listTripsForUser(session.id).catch(() => []),
    listTravelerBookings(session.id).catch(() => [])
  ]);

  return (
    <AppShell>
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <section className="rounded-[8px] border border-white/14 bg-black/30 p-5 backdrop-blur-xl md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-aurora">Trips</p>
              <h1 className="mt-2 text-4xl font-semibold text-white">AI trip plans</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/62">
                Private traveler plans, grounded in WanderOS stays and versioned in Aurora.
              </p>
            </div>
            <Link href="/trips/new" className="inline-flex items-center gap-2 rounded-[8px] bg-white px-4 py-3 text-sm font-semibold text-night transition hover:bg-white/90">
              <Plus className="h-4 w-4" />
              New trip
            </Link>
          </div>

          <div className="mt-6 grid gap-3">
            {trips.map((trip) => (
              <Link key={trip.id} href={`/trips/${trip.id}`} className="rounded-[8px] border border-white/10 bg-white/8 p-4 transition hover:bg-white/14">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold text-white">{trip.title}</p>
                    <p className="mt-1 text-sm text-white/58">{trip.destination}</p>
                    <p className="mt-2 inline-flex items-center gap-2 text-xs text-white/52">
                      <CalendarDays className="h-3.5 w-3.5" /> {formatDate(trip.start_date)} to {formatDate(trip.end_date)}
                    </p>
                  </div>
                  <span className="rounded-[8px] border border-white/12 bg-white/8 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-white/62">
                    {trip.status}
                  </span>
                </div>
              </Link>
            ))}
            {!trips.length ? (
              <div className="rounded-[8px] border border-white/10 bg-white/8 p-5">
                <Sparkles className="h-5 w-5 text-aurora" />
                <p className="mt-3 text-sm text-white/62">No trip plans yet.</p>
                <Link href="/trips/new" className="mt-4 inline-flex items-center gap-2 rounded-[8px] bg-white px-4 py-3 text-sm font-semibold text-night">
                  <Plus className="h-4 w-4" />
                  Create trip
                </Link>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="rounded-[8px] border border-white/14 bg-black/30 p-5 backdrop-blur-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-peach">Bookings</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Confirmed stays</h2>
          <div className="mt-5 space-y-3">
            {bookings.slice(0, 4).map((booking) => (
              <Link key={booking.id} href={`/listing/${booking.listing_id}`} className="grid grid-cols-[76px_1fr] gap-3 rounded-[8px] border border-white/10 bg-white/8 p-3 transition hover:bg-white/14">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {booking.image_url ? <img src={booking.image_url} alt="" className="h-16 w-full rounded-[8px] object-cover" /> : <div className="h-16 rounded-[8px] bg-white/10" />}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{booking.title}</p>
                  <p className="mt-1 text-xs text-white/55">{booking.city} · {formatDate(booking.check_in)}</p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-aurora">{booking.status}</p>
                </div>
              </Link>
            ))}
            {!bookings.length ? <p className="rounded-[8px] border border-white/10 bg-white/8 p-4 text-sm text-white/58">No confirmed stays yet.</p> : null}
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
