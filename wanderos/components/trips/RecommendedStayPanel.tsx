import Link from "next/link";
import { Home, MapPin } from "lucide-react";

type StayRecommendation = {
  listingId: string;
  title: string;
  area?: string;
  pricePerNight?: number;
  currency?: string;
  matchScore?: number;
  why?: string;
};

function staysFromContext(context: Record<string, unknown>): StayRecommendation[] {
  const stays = context.stayRecommendations;
  if (!Array.isArray(stays)) return [];
  return stays.filter((stay): stay is StayRecommendation => {
    const candidate = stay as StayRecommendation;
    return Boolean(candidate.listingId && candidate.title);
  });
}

export function RecommendedStayPanel({ context }: { context: Record<string, unknown> }) {
  const stays = staysFromContext(context);

  return (
    <section className="rounded-[8px] border border-[#f2cfb0] bg-[#fffaf2]/95 p-4 text-[#4b4038] shadow-[0_18px_40px_rgba(50,31,18,0.18)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#d87562]">Stays</p>
          <h2 className="mt-1 text-lg font-semibold text-[#4a4038]">Recommended</h2>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-[#f2cfb0] bg-[#fff3e6]">
          <Home className="h-4 w-4 text-[#d87562]" />
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {stays.map((stay, index) => (
          <Link key={stay.listingId} href={`/listing/${stay.listingId}`} className="block rounded-[8px] border border-[#f2cfb0] bg-[#fffdf8] p-3 shadow-[0_10px_24px_rgba(72,48,30,0.10)] transition hover:border-[#ffb397]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#483b32]">{index + 1}. {stay.title}</p>
                {stay.area ? <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-[#8b6d58]"><MapPin className="h-3.5 w-3.5" /> {stay.area}</p> : null}
              </div>
              {stay.pricePerNight ? <p className="shrink-0 text-sm font-semibold text-[#745642]">{stay.currency || "USD"} {stay.pricePerNight}</p> : null}
            </div>
            {stay.why ? <p className="mt-2 text-xs leading-5 text-[#856b59]">{stay.why}</p> : null}
          </Link>
        ))}
        {!stays.length ? <p className="rounded-[8px] border border-[#f2cfb0] bg-[#fffdf8] p-3 text-sm text-[#856b59]">No approved stay matched this plan yet.</p> : null}
      </div>
    </section>
  );
}
