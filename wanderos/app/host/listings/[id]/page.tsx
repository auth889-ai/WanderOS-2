import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getListing } from "@/lib/services/listing.service";
import { HostLayout } from "@/components/host/HostLayout";
import { ListingDetailView } from "@/components/host-studio/ListingDetailView";
import { ListingHeaderActions } from "@/components/host-studio/ListingHeaderActions";
import { VideoStudio } from "@/components/host-studio/VideoStudio";
import type { ListingRow } from "@/lib/api/host-listings";

export const dynamic = "force-dynamic";

export default async function HostListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "host") redirect("/");

  const { id } = await params;
  const row = await getListing(id).catch(() => null);
  if (!row || row.host_id !== session.id) notFound(); // RBAC: owner only

  const listing = row as unknown as ListingRow;
  const pricing = (row.pricing_analysis ?? {}) as { currency?: string };

  return (
    <HostLayout title="Listing" subtitle="Your AI-built listing — review, edit, and publish." hostName={session.name}>
      {/* single column: action bar (price · status · edit · publish · delete) on top, full-width detail below */}
      <ListingHeaderActions listing={listing} currency={pricing.currency ?? "AED"} />
      <div className="mb-6"><VideoStudio listingId={listing.id} /></div>
      <ListingDetailView listing={listing} />
    </HostLayout>
  );
}
