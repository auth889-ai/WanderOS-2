import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, CalendarDays, MapPin } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { BudgetPanel } from "@/components/trips/BudgetPanel";
import { DayTimeline } from "@/components/trips/DayTimeline";
import { PlanControls } from "@/components/trips/PlanControls";
import { PlanProgress } from "@/components/trips/PlanProgress";
import { RecommendedStayPanel } from "@/components/trips/RecommendedStayPanel";
import { getSession } from "@/lib/auth/session";
import { getTripVisuals } from "@/lib/media/trip-visuals";
import { getTrip } from "@/lib/services/trip.service";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function formatDate(value: string | null | undefined) {
  if (!value) return "Open dates";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function money(value: string | number | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return "Budget open";
  return `$${amount.toLocaleString()}`;
}

export default async function TripDetailPage({ params }: { params: Promise<{ id: string }> }) {
  noStore();
  await connection();
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "host") redirect("/host/dashboard");
  if (session.role === "admin") redirect("/admin");

  const { id } = await params;
  const result = await getTrip(session.id, id);
  if (!result) notFound();

  const { trip, activePlan } = result;
  const context = (activePlan?.version.planning_context ?? {}) as Record<string, unknown>;
  const isPlanning = trip.status === "planning";
  const visuals = await getTripVisuals({
    destination: trip.destination,
    dayCount: activePlan?.days.length || 1
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <Link href="/trips" className="inline-flex items-center gap-2 text-sm font-semibold text-white/68 transition hover:text-white">
          <ArrowLeft className="h-4 w-4" />
          Trips
        </Link>

        <section className="overflow-hidden rounded-[8px] border border-[#f2cfb0] bg-[#fffaf2]/95 text-[#4b4038] shadow-[0_24px_60px_rgba(50,31,18,0.24)] backdrop-blur-xl">
          <div className="grid lg:grid-cols-[340px_1fr]">
            <div className="relative min-h-[230px] overflow-hidden bg-[#f8dcc6]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={visuals.hero.src} alt={visuals.hero.alt} className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(45,28,18,0.02),rgba(45,28,18,0.45))]" />
              {visuals.hero.source === "unsplash" ? (
                <p className="absolute bottom-3 left-3 rounded-[8px] bg-black/44 px-2.5 py-1 text-[11px] text-white/88">
                  Photo: {visuals.hero.photographerName || "Unsplash"}
                </p>
              ) : null}
            </div>

            <div className="p-5 md:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#d87562]">Trip workspace</p>
                  <h1 className="mt-2 max-w-4xl text-4xl font-semibold text-[#4a4038]">{trip.title}</h1>
                  <div className="mt-3 flex flex-wrap gap-3 text-sm text-[#856b59]">
                    <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" /> {trip.destination}</span>
                    <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" /> {formatDate(trip.start_date)} to {formatDate(trip.end_date)}</span>
                    <span>{money(trip.budget)}</span>
                  </div>
                </div>
                <span className="rounded-[8px] border border-[#f2cfb0] bg-[#fff3e6] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#8b6d58]">
                  {trip.status}
                </span>
              </div>
              {activePlan?.version.ai_summary ? <p className="mt-5 max-w-4xl text-sm leading-6 text-[#806958]">{activePlan.version.ai_summary}</p> : null}
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-5">
            {isPlanning ? <PlanProgress tripId={trip.id} /> : null}
            {activePlan ? (
              <DayTimeline tripId={trip.id} days={activePlan.days} items={activePlan.items} visuals={visuals.days} />
            ) : (
              <section className="rounded-[8px] border border-[#f2cfb0] bg-[#fffaf2]/95 p-5 text-sm text-[#856b59] shadow-[0_18px_40px_rgba(50,31,18,0.18)] backdrop-blur-xl">
                Plan version is waiting for the worker.
              </section>
            )}
          </div>

          <aside className="space-y-5">
            <PlanControls tripId={trip.id} />
            <BudgetPanel context={context} />
            <RecommendedStayPanel context={context} />
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
