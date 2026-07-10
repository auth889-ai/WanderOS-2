import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Composer } from "@/components/feed/Composer";
import { getSession } from "@/lib/auth/session";
import { listTravelerBookings } from "@/lib/services/booking.service";

export const dynamic = "force-dynamic";

/** Separate AI post composer page (travelmate-style: feed and compose are different pages). */
export default async function NewPostPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "host") redirect("/host/dashboard");
  if (session.role === "admin") redirect("/admin");

  const bookings = await listTravelerBookings(session.id).catch(() => []);
  const slim = bookings.map((b) => ({ listing_id: b.listing_id, title: b.title, city: b.city }));

  return (
    <AppShell>
      <Composer bookings={slim} />
    </AppShell>
  );
}
