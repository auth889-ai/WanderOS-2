import Link from "next/link";
import type { ListingRow } from "@/lib/api/host-listings";

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "border-white/20 bg-white/10 text-white/80" },
  editing: { label: "Editing", cls: "border-white/20 bg-white/10 text-white/80" },
  pending_review: { label: "Pending review", cls: "border-peach/40 bg-peach/15 text-peach" },
  approved: { label: "Approved", cls: "border-mist/40 bg-mist/15 text-white" },
  published: { label: "Published", cls: "border-aurora/40 bg-aurora/15 text-white" },
  archived: { label: "Archived", cls: "border-white/15 bg-white/5 text-white/50" }
};

const FALLBACK = "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?q=80&w=1200&auto=format&fit=crop";

/** A host listing card for the dashboard grid (cover · status · title · location · price). */
export function ListingCard({ listing }: { listing: ListingRow }) {
  const s = STATUS[listing.status] ?? STATUS.draft;
  const generating = listing.title.startsWith("Generating");
  return (
    <Link href={`/host/listings/${listing.id}`} className="group glass overflow-hidden rounded-[24px] transition hover:shadow-glow">
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={listing.image_url || FALLBACK} alt="" className="h-48 w-full object-cover transition group-hover:scale-[1.03]" />
        <span className={`absolute left-3 top-3 rounded-full border px-3 py-1 text-xs font-medium ${s.cls}`}>{s.label}</span>
      </div>
      <div className="p-5">
        <h3 className="truncate text-lg font-semibold">{generating ? "Generating your listing…" : listing.title}</h3>
        <p className="mt-1 text-sm text-white/60">
          {listing.city}, {listing.country}
        </p>
        <p className="mt-3 text-xl font-bold">
          {Number(listing.price) ? Number(listing.price).toLocaleString() : "—"}
          <span className="ml-1 text-sm font-normal text-white/55">/ night</span>
        </p>
      </div>
    </Link>
  );
}
