import { CalendarDays, Clock3, ExternalLink, MapPin, Star } from "lucide-react";
import type { ItineraryDayRow } from "@/lib/db/tables/trip/days";
import type { ItineraryItemRow } from "@/lib/db/tables/trip/items";
import type { TripVisual } from "@/lib/media/trip-visuals";
import { AddItineraryItemForm } from "./AddItineraryItemForm";
import { ItineraryItemControls } from "./ItineraryItemControls";

function money(value: string | number | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return `$${amount.toLocaleString()}`;
}

function dateLabel(value: string | null) {
  if (!value) return "Date pending";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function itemMetadata(item: ItineraryItemRow) {
  const metadata = item.metadata || {};
  return {
    website: typeof metadata.googleWebsite === "string" ? metadata.googleWebsite : "",
    userRatingsTotal: typeof metadata.googleUserRatingsTotal === "number" ? metadata.googleUserRatingsTotal : null,
    openingHours: Array.isArray(metadata.googleOpeningHours)
      ? metadata.googleOpeningHours.filter((line): line is string => typeof line === "string").slice(0, 3)
      : [],
    placeSource: typeof metadata.googlePlaceSource === "string" ? metadata.googlePlaceSource : "",
    placeTypes: Array.isArray(metadata.googlePlaceTypes)
      ? metadata.googlePlaceTypes.filter((line): line is string => typeof line === "string").slice(0, 4)
      : [],
    travelerTip: typeof metadata.travelerTip === "string" ? metadata.travelerTip : "",
    verificationNote: typeof metadata.verificationNote === "string" ? metadata.verificationNote : ""
  };
}

export function DayTimeline({
  tripId,
  days,
  items,
  visuals = {}
}: {
  tripId: string;
  days: ItineraryDayRow[];
  items: ItineraryItemRow[];
  visuals?: Record<number, TripVisual>;
}) {
  const byDay = new Map<number, ItineraryItemRow[]>();
  for (const item of items) {
    byDay.set(item.day_number, [...(byDay.get(item.day_number) || []), item]);
  }

  return (
    <section className="space-y-4">
      {days.map((day) => (
        <article key={day.id} className="overflow-hidden rounded-[8px] border border-[#f2cfb0] bg-[#fffaf2]/95 text-[#4b4038] shadow-[0_22px_50px_rgba(50,31,18,0.22)] backdrop-blur-xl">
          <div className="grid gap-0 lg:grid-cols-[230px_1fr]">
            <div className="relative min-h-[180px] overflow-hidden bg-[#f8dcc6]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={(visuals[day.day_number] || {}).src || "/images/traveler-dashboard/t_6.png"}
                alt={(visuals[day.day_number] || {}).alt || ""}
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(45,28,18,0.03),rgba(45,28,18,0.42))]" />
              {(visuals[day.day_number] || {}).source === "unsplash" ? (
                <p className="absolute bottom-2 left-2 rounded-[8px] bg-black/42 px-2 py-1 text-[10px] text-white/86">
                  Photo: {(visuals[day.day_number] || {}).photographerName || "Unsplash"}
                </p>
              ) : null}
            </div>

            <div className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#d87562]">Day {day.day_number}</p>
                  <h2 className="mt-1 text-xl font-semibold text-[#4a4038]">{day.theme || "Open day"}</h2>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-[#8f725f]">
                    <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" /> {dateLabel(day.date)}</span>
                    {day.area ? <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> {day.area}</span> : null}
                  </div>
                </div>
              </div>
              {day.summary ? <p className="mt-3 text-sm leading-6 text-[#806958]">{day.summary}</p> : null}

              <div className="mt-4 space-y-3">
                {(byDay.get(day.day_number) || []).map((item) => (
                  <div key={item.id} className="grid gap-3 rounded-[8px] border border-[#f4d8bf] bg-[#fffdf8] p-3 shadow-[0_10px_24px_rgba(72,48,30,0.10)] sm:grid-cols-[110px_1fr_auto]">
                    {(() => {
                      const details = itemMetadata(item);
                      return (
                        <>
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#bd8060]">
                      <Clock3 className="mb-1 h-3.5 w-3.5" />
                      {item.time_label || "Flexible"}
                    </div>
                    <div className="min-w-0">
                      {item.image_url ? (
                        <div className="relative mb-3 h-36 overflow-hidden rounded-[8px] bg-[#f7ddc6]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={item.image_url} alt={item.title} className="h-full w-full object-cover" />
                        </div>
                      ) : null}
                      <p className="font-semibold text-[#483b32]">{item.title}</p>
                      {item.description ? <p className="mt-1 text-sm leading-6 text-[#856b59]">{item.description}</p> : null}
                      <div className="mt-2 space-y-1 text-xs text-[#8d715d]">
                        {item.place_name ? (
                          <p className="flex flex-wrap items-center gap-1.5">
                            <MapPin className="h-3.5 w-3.5 text-[#d87562]" />
                            <span className="font-semibold text-[#6d5747]">{item.place_name}</span>
                            {item.place_rating ? (
                              <span className="inline-flex items-center gap-1 text-[#9d725a]">
                                <Star className="h-3.5 w-3.5 fill-[#d99b55] text-[#d99b55]" />
                                {Number(item.place_rating).toFixed(1)}
                                {details.userRatingsTotal ? ` (${details.userRatingsTotal.toLocaleString()})` : ""}
                              </span>
                            ) : null}
                            {item.place_url ? (
                              <a href={item.place_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[#b85e4f] hover:text-[#8f4639]">
                                Maps
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : null}
                            {details.website ? (
                              <a href={details.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[#b85e4f] hover:text-[#8f4639]">
                                Official site
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : null}
                          </p>
                        ) : null}
                        {item.place_address ? <p>{item.place_address}</p> : null}
                        {item.selection_rationale ? (
                          <div className="rounded-[8px] border border-[#f2cfb0] bg-[#fffaf2] p-2">
                            <p className="font-semibold text-[#6d5747]">Why this stop</p>
                            <p>{item.selection_rationale}</p>
                          </div>
                        ) : null}
                        {item.timing_rationale ? (
                          <div className="rounded-[8px] border border-[#f2cfb0] bg-[#fffaf2] p-2">
                            <p className="font-semibold text-[#6d5747]">Why this timing</p>
                            <p>{item.timing_rationale}</p>
                          </div>
                        ) : null}
                        {details.openingHours.length ? (
                          <div className="rounded-[8px] border border-[#f2cfb0] bg-[#fffaf2] p-2">
                            <p className="font-semibold text-[#6d5747]">Opening hours from Google</p>
                            {details.openingHours.map((line) => <p key={line}>{line}</p>)}
                          </div>
                        ) : null}
                        {details.travelerTip ? (
                          <div className="rounded-[8px] border border-[#f2cfb0] bg-[#fffaf2] p-2">
                            <p className="font-semibold text-[#6d5747]">Traveler tip</p>
                            <p>{details.travelerTip}</p>
                          </div>
                        ) : null}
                        {details.verificationNote ? (
                          <div className="rounded-[8px] border border-[#f2cfb0] bg-[#fffaf2] p-2">
                            <p className="font-semibold text-[#6d5747]">Verified by</p>
                            <p>{details.verificationNote}</p>
                          </div>
                        ) : null}
                        {item.cost_rationale ? <p className="text-[#9a7761]">{item.cost_rationale}</p> : null}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {item.category ? <span className="rounded-[8px] border border-[#f2cfb0] bg-[#fff4e8] px-2 py-1 text-xs text-[#8b6d58]">{item.category}</span> : null}
                        {item.cost_source ? <span className="rounded-[8px] border border-[#d2b08f] bg-[#fffaf2] px-2 py-1 text-xs text-[#8b6d58]">{item.cost_source.replaceAll("_", " ")}</span> : null}
                        {details.placeSource ? <span className="rounded-[8px] border border-[#d2b08f] bg-[#fffaf2] px-2 py-1 text-xs text-[#8b6d58]">{details.placeSource.replaceAll("_", " ")}</span> : null}
                        {details.placeTypes.map((type) => (
                          <span key={type} className="rounded-[8px] border border-[#f2cfb0] bg-[#fff4e8] px-2 py-1 text-xs text-[#8b6d58]">{type.replaceAll("_", " ")}</span>
                        ))}
                        {item.locked ? <span className="rounded-[8px] border border-[#d87562]/30 bg-[#ffe7df] px-2 py-1 text-xs text-[#d87562]">Locked</span> : null}
                      </div>
                      <ItineraryItemControls tripId={tripId} item={item} />
                    </div>
                    <div className="text-sm font-semibold text-[#745642]">{money(item.est_cost) || "Included"}</div>
                        </>
                      );
                    })()}
                  </div>
                ))}
                <AddItineraryItemForm tripId={tripId} dayNumber={day.day_number} />
              </div>
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}
