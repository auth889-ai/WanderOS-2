import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Sparkles } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { TripBrief } from "@/components/trips/TripBrief";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function NewTripPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "host") redirect("/host/dashboard");
  if (session.role === "admin") redirect("/admin");

  return (
    <AppShell>
      <div className="space-y-6">
        <Link href="/trips" className="inline-flex items-center gap-2 text-sm font-semibold text-white/68 transition hover:text-white">
          <ArrowLeft className="h-4 w-4" />
          Trips
        </Link>
        <section className="rounded-[8px] border border-white/14 bg-black/30 p-5 backdrop-blur-xl md:p-6">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-[8px] border border-white/12 bg-white/8">
              <Sparkles className="h-5 w-5 text-aurora" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-aurora">Planner intake</p>
              <h1 className="mt-1 text-3xl font-semibold text-white">Create AI itinerary</h1>
            </div>
          </div>
          <TripBrief />
        </section>
      </div>
    </AppShell>
  );
}
