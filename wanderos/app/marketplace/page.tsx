import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { listPublic } from "@/lib/db/tables/listings";

export const dynamic = "force-dynamic";

/** Public marketplace — browse approved listings. Approved = admin-published; never shows drafts/pending. */
export default async function MarketplacePage() {
  const listings = await listPublic().catch(() => []);

  return (
    <AppShell>
      <h1 className="text-4xl font-semibold">Explore stays</h1>
      <p className="mt-2 text-white/55">{listings.length} place{listings.length === 1 ? "" : "s"} ready to book.</p>

      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {listings.map((l) => (
          <Link key={l.id} href={`/listing/${l.id}`} className="group overflow-hidden rounded-[20px] border border-white/10 bg-white/5 transition hover:-translate-y-0.5 hover:bg-white/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {l.image_url ? <img src={l.image_url} alt={l.title} className="h-48 w-full object-cover" /> : <div className="h-48 w-full bg-white/10" />}
            <div className="p-4">
              <p className="truncate font-semibold text-white">{l.title}</p>
              <p className="truncate text-sm text-white/55">{l.city}, {l.country}</p>
              <p className="mt-2 font-semibold text-white">{Number(l.price).toLocaleString()}<span className="ml-1 text-sm font-normal text-white/55">/ night</span></p>
            </div>
          </Link>
        ))}
        {listings.length === 0 && <p className="text-white/55">No stays published yet — check back soon.</p>}
      </div>
    </AppShell>
  );
}
