import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getHostListings } from "@/lib/services/listing.service";
import { HostLayout } from "@/components/host/HostLayout";
import { ListingCard } from "@/components/host-studio/ListingCard";
import type { ListingRow } from "@/lib/api/host-listings";

export const dynamic = "force-dynamic";

export default async function HostDashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "host") redirect("/");

  const listings = (await getHostListings(session.id)) as unknown as ListingRow[];
  const live = listings.filter((l) => l.status === "published" || l.moderation_status === "approved").length;
  const pending = listings.filter((l) => l.status === "pending_review").length;

  const statCards = [
    { title: "Listings", value: String(listings.length), sub: "Properties you manage" },
    { title: "Live", value: String(live), sub: "Approved & visible" },
    { title: "Pending review", value: String(pending), sub: "Awaiting admin" },
    { title: "Earnings", value: "$0", sub: "Bookings ship next" }
  ];

  return (
    <HostLayout title="Dashboard" subtitle="Your host control center — listings, status and activity." hostName={session.name}>
      <div className="space-y-6">
        {/* HERO */}
        <section className="relative overflow-hidden rounded-[34px] border border-white/10 bg-gradient-to-r from-coral/15 via-mist/5 to-aurora/5 p-8 shadow-glow backdrop-blur-2xl">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.10),transparent_38%)]" />
          <div className="relative z-10 grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
            <div>
              <span className="mb-3 inline-flex rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.2em] text-white/75">
                AI host workspace
              </span>
              <h2 className="text-4xl font-bold tracking-tight md:text-5xl">List like a real platform — in 90 seconds.</h2>
              <p className="mt-3 max-w-2xl text-white/70">
                Drop your photos and a crew of AI agents writes the copy, prices it from real comparables, and builds an
                Airbnb-grade detail page. You review, edit and publish.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                {[["Listings", String(listings.length)], ["Pending review", String(pending)], ["Live", String(live)]].map(([k, v]) => (
                  <div key={k} className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
                    <p className="text-xs text-white/50">{k}</p>
                    <p className="mt-1 text-2xl font-bold">{v}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid place-content-center">
              <Link
                href="/host/listings/new"
                className="rounded-2xl bg-gradient-to-r from-coral to-mist px-7 py-4 text-center text-base font-semibold text-night shadow-coral transition hover:brightness-110"
              >
                ✦ Create a new listing
              </Link>
            </div>
          </div>
        </section>

        {/* STAT CARDS */}
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {statCards.map((c) => (
            <div key={c.title} className="glass rounded-[28px] p-5">
              <p className="text-sm text-white/65">{c.title}</p>
              <h3 className="mt-3 text-3xl font-bold tabular-nums">{c.value}</h3>
              <p className="mt-2 text-sm text-white/45">{c.sub}</p>
            </div>
          ))}
        </div>

        {/* LISTINGS */}
        <div className="flex items-center justify-between pt-2">
          <h2 className="text-2xl font-semibold">Your listings</h2>
          <Link href="/host/listings/new" className="rounded-2xl border border-white/12 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10">
            + New listing
          </Link>
        </div>

        {listings.length === 0 ? (
          <div className="glass grid place-items-center rounded-[28px] p-16 text-center">
            <p className="text-xl font-semibold">No listings yet</p>
            <p className="mt-2 max-w-md text-white/60">Upload a few photos and let the AI studio write, price and detail your first listing.</p>
            <Link href="/host/listings/new" className="mt-6 rounded-2xl bg-gradient-to-r from-coral to-mist px-6 py-3.5 text-sm font-semibold text-night shadow-coral transition hover:brightness-110">
              ✦ Create your first listing
            </Link>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        )}
      </div>
    </HostLayout>
  );
}
