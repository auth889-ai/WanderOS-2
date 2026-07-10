import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getSession } from "@/lib/auth/session";
import { listTripsForUser } from "@/lib/db/tables/trips";
import { listTravelerBookings } from "@/lib/services/booking.service";

export const dynamic = "force-dynamic";

function formatMoney(value: string | number | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return "0";
  return amount.toLocaleString();
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function dateTime(value: string | null | undefined) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export default async function TravelerDashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "host") redirect("/host/dashboard");
  if (session.role === "admin") redirect("/admin");

  const [bookings, trips] = await Promise.all([
    listTravelerBookings(session.id).catch(() => []),
    listTripsForUser(session.id).catch(() => [])
  ]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcomingBookings = bookings
    .filter((booking) => booking.status !== "cancelled" && dateTime(booking.check_in) >= today.getTime())
    .sort((a, b) => dateTime(a.check_in) - dateTime(b.check_in))
    .slice(0, 2);
  const activeTrips = trips.filter((trip) => trip.status !== "archived").slice(0, 3);
  const totalCommitted = bookings.reduce((sum, booking) => sum + Number(booking.total_amount || 0), 0);

  return (
    <AppShell>
      <div className="space-y-7">
        <section className="overflow-hidden rounded-[24px] border border-white/15 bg-black/28 shadow-2xl shadow-black/25 backdrop-blur-xl">
          <div className="grid gap-6 p-6 md:grid-cols-[1fr_320px] md:p-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-aurora">Traveler Dashboard</p>
              <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-tight text-white md:text-5xl">
                Welcome back, {session.name || "traveler"}
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-white/68">
                Plan AI-powered trips, track confirmed stays, and keep your travel work private to your account.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/trips" className="rounded-[8px] bg-white px-4 py-3 text-sm font-semibold text-night">
                  Open trips
                </Link>
                <Link href="/marketplace" className="rounded-[8px] border border-white/15 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/15">
                  Explore stays
                </Link>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 md:grid-cols-1">
              <Metric label="Trips" value={trips.length.toString()} />
              <Metric label="Bookings" value={bookings.length.toString()} />
              <Metric label="Committed" value={`$${formatMoney(totalCommitted)}`} />
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <section className="rounded-[20px] border border-white/14 bg-black/26 p-5 backdrop-blur-xl">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-peach">Planning</p>
                <h2 className="mt-1 text-2xl font-semibold">Active trip plans</h2>
              </div>
              <Link href="/trips" className="text-sm font-semibold text-white/72 transition hover:text-white">
                View all
              </Link>
            </div>

            <div className="mt-5 space-y-3">
              {activeTrips.length > 0 ? (
                activeTrips.map((trip) => (
                  <Link key={trip.id} href="/trips" className="block rounded-[14px] border border-white/10 bg-white/8 p-4 transition hover:bg-white/12">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-white">{trip.title}</p>
                        <p className="mt-1 text-sm text-white/60">{trip.destination} · {formatDate(trip.start_date)} to {formatDate(trip.end_date)}</p>
                      </div>
                      <span className="shrink-0 rounded-[8px] border border-white/12 bg-white/10 px-2.5 py-1 text-xs font-semibold capitalize text-white/70">
                        {trip.status}
                      </span>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="rounded-[14px] border border-white/10 bg-white/8 p-5 text-sm text-white/62">
                  No active trip plans yet. Start from Trips to create your first AI plan.
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-6">
            <section className="rounded-[20px] border border-white/14 bg-black/26 p-5 backdrop-blur-xl">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-aurora">Bookings</p>
              <h2 className="mt-1 text-2xl font-semibold">Upcoming stays</h2>
              <div className="mt-5 space-y-3">
                {upcomingBookings.length > 0 ? (
                  upcomingBookings.map((booking) => (
                    <Link key={booking.id} href={`/listing/${booking.listing_id}`} className="grid grid-cols-[82px_1fr] gap-3 rounded-[14px] border border-white/10 bg-white/8 p-3 transition hover:bg-white/12">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {booking.image_url ? (
                        <img src={booking.image_url} alt="" className="h-16 w-full rounded-[10px] object-cover" />
                      ) : (
                        <div className="h-16 rounded-[10px] bg-white/10" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{booking.title}</p>
                        <p className="mt-1 text-xs text-white/58">{booking.city} · {formatDate(booking.check_in)}</p>
                        <p className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-aurora">{booking.status}</p>
                      </div>
                    </Link>
                  ))
                ) : (
                  <p className="rounded-[14px] border border-white/10 bg-white/8 p-4 text-sm text-white/62">
                    No upcoming stays. Browse approved WanderOS listings when you are ready to book.
                  </p>
                )}
              </div>
            </section>

            <section className="rounded-[20px] border border-white/14 bg-black/26 p-5 backdrop-blur-xl">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-peach">Quick Actions</p>
              <div className="mt-4 grid gap-3">
                <ActionLink href="/trips" label="Plan with AI" />
                <ActionLink href="/feed" label="Create travel post" />
                <ActionLink href="/memory-books" label="Build a memory book" />
                <ActionLink href="/marketplace" label="Explore stays" />
              </div>
            </section>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] border border-white/12 bg-white/10 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-white/54">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

function ActionLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="rounded-[10px] border border-white/12 bg-white/8 px-4 py-3 text-sm font-semibold text-white/78 transition hover:bg-white/14 hover:text-white">
      {label}
    </Link>
  );
}
