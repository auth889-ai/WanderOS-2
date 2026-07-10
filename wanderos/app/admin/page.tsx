import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { listForAdmin, adminStats } from "@/lib/db/tables/listings";
import { AdminModeration, type AdminListing } from "@/components/admin/AdminModeration";
import { Building2, Clock, CheckCircle2, CalendarCheck, Wallet, Users } from "lucide-react";

export const dynamic = "force-dynamic";

/** Admin control center — Pandio light theme · real stats · approve/reject/delete listings. Admin-only. */
export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/");

  const [listings, stats] = await Promise.all([
    listForAdmin().catch(() => []),
    adminStats().catch(() => ({ listings: 0, pending: 0, approved: 0, rejected: 0, hosts: 0, bookings: 0, revenue: 0 }))
  ]);

  const rows: AdminListing[] = listings.map((l) => ({
    id: l.id, title: l.title, city: l.city, country: l.country, category: l.category,
    host_name: l.host_name, image_url: l.image_url, moderation_status: l.moderation_status,
    price: Number(l.price), status: l.status,
    has_video: !!(l as unknown as { tour?: { url?: string } }).tour?.url
  }));

  const cards = [
    { label: "Listings", value: stats.listings.toLocaleString(), icon: Building2, tile: "bg-[#fce2dc] text-[#ef6d5b]" },
    { label: "Pending", value: stats.pending.toLocaleString(), icon: Clock, tile: "bg-[#fbecd6] text-[#d8932f]" },
    { label: "Approved", value: stats.approved.toLocaleString(), icon: CheckCircle2, tile: "bg-[#dcefe0] text-[#2f8a52]" },
    { label: "Bookings", value: stats.bookings.toLocaleString(), icon: CalendarCheck, tile: "bg-[#e3e0fb] text-[#6b5bd8]" },
    { label: "Revenue", value: stats.revenue.toLocaleString(), icon: Wallet, tile: "bg-[#fde7e0] text-[#e0673f]" },
    { label: "Hosts", value: stats.hosts.toLocaleString(), icon: Users, tile: "bg-[#f4ead7] text-[#c79a3a]" }
  ];

  return (
    <div className="min-h-screen bg-[#fdf8f3] text-[#312b27]">
      <header className="flex items-center justify-between border-b border-[#f0e6dc] bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#ef6d5b] font-black text-white">W</span>
          <div><p className="font-semibold">WanderOS Admin</p><p className="text-xs text-[#8a7e76]">{session.name}</p></div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link href="/marketplace" className="rounded-xl border border-[#f0e6dc] px-3 py-2 hover:bg-[#faf3ec]">Marketplace</Link>
          <Link href="/api/auth/logout" className="rounded-xl border border-[#f0e6dc] px-3 py-2 hover:bg-[#faf3ec]">Logout</Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="text-3xl font-bold">Control center</h1>
        <p className="mt-1 text-[#8a7e76]">Review host listings, approve to publish them to the marketplace, and watch revenue grow.</p>

        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {cards.map(({ label, value, icon: Icon, tile }) => (
            <div key={label} className="rounded-2xl border border-[#f0e6dc] bg-white p-4 shadow-[0_8px_30px_rgba(20,12,8,0.05)]">
              <div className={`grid h-10 w-10 place-items-center rounded-xl ${tile}`}><Icon size={18} /></div>
              <p className="mt-3 text-2xl font-bold">{value}</p>
              <p className="text-xs text-[#8a7e76]">{label}</p>
            </div>
          ))}
        </div>

        <h2 className="mt-9 text-xl font-semibold">Marketplace review</h2>
        <p className="mb-4 text-sm text-[#8a7e76]">Approve a listing to publish it to travelers. Reject or delete to remove it.</p>
        <AdminModeration initial={rows} />
      </main>
    </div>
  );
}
