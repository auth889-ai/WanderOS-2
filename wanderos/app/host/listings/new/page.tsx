import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { HostLayout } from "@/components/host/HostLayout";
import { StudioClient } from "./StudioClient";

export const dynamic = "force-dynamic";

export default async function NewListingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "host") redirect("/");
  return (
    <HostLayout title="Create Listing" subtitle="Your AI studio — write, price and film a listing that markets itself." hostName={session.name}>
      <StudioClient />
    </HostLayout>
  );
}
