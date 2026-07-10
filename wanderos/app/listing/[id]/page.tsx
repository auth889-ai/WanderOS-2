import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getById } from "@/lib/db/tables/listings";
import { ListingDetailView } from "@/components/host-studio/ListingDetailView";
import { BookingWidget } from "@/components/marketplace/BookingWidget";
import type { ListingRow } from "@/lib/api/host-listings";

export const dynamic = "force-dynamic";

/** Public listing detail (traveler view) — only APPROVED listings are visible. Includes the video tour + booking. */
export default async function PublicListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await getById(id).catch(() => null);
  if (!row || row.moderation_status !== "approved") notFound(); // public sees approved only

  const listing = row as unknown as ListingRow;

  return (
    <AppShell>
      <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
        <ListingDetailView listing={listing} />
        <div className="lg:sticky lg:top-6 lg:self-start">
          <BookingWidget listingId={listing.id} pricePerNight={Number(listing.price)} maxGuests={listing.max_guests || 1} />
        </div>
      </div>
    </AppShell>
  );
}
