import type { ListingRow } from "@/lib/api/host-listings";
import { PhotoGallery } from "./PhotoGallery";
import {
  Sparkles, MapPin, BedDouble, Wifi, Baby, Home, Bath, Tv, Wind, UtensilsCrossed, Car, ShieldCheck, Coffee, Building2,
  Check, Waves, WashingMachine, Dumbbell, Trees, Wine,
  type LucideIcon
} from "lucide-react";

/**
 * Airbnb-structured listing detail. Boxes use the PANDIO palette: soft cream cards, dark text, and
 * coral/amber pastel icon tiles + a soft shadow — sitting on the cinematic background. Section
 * headings stay light (on the dark bg); the cards are the bright, premium surfaces.
 */
// Pandio palette — soft cream cards, dark warm text, coral/amber pastel icon tiles
const CARD = "rounded-2xl border border-[#efe2d6] bg-[#fcf7f1] shadow-[0_16px_44px_rgba(15,9,20,0.45)]";
const TITLE = "text-[#312b27] font-semibold";
const BODY = "text-[#7b7068]";
const TXT = "text-[#867b72]";
const MUTED = "text-[#a89e95]";

// pastel icon tiles, Pandio-style (coral · amber · terracotta · gold), cycled — literal classes so Tailwind emits them
const ACCENTS = [
  "bg-[#fce2dc] text-[#ef6d5b]",
  "bg-[#fbecd6] text-[#d8932f]",
  "bg-[#fde7e0] text-[#e0673f]",
  "bg-[#f4ead7] text-[#c79a3a]"
];

function highlightIcon(text: string): LucideIcon {
  const t = text.toLowerCase();
  if (/play|kid|child|family|crib/.test(t)) return Baby;
  if (/location|access|near|marina|walk|downtown|metro|tram|transit/.test(t)) return MapPin;
  if (/bed|suite|sleep|room/.test(t)) return BedDouble;
  if (/wifi|tv|comfort|modern|ac|air|smart|internet/.test(t)) return Wifi;
  return Sparkles;
}
/** map an amenity name → a relevant icon for the amenities grid */
function amenityIcon(name: string): LucideIcon {
  const t = name.toLowerCase();
  if (/wifi|internet/.test(t)) return Wifi;
  if (/tv|television|netflix|smart/.test(t)) return Tv;
  if (/air ?cond|\bac\b|cool|fan|heat/.test(t)) return Wind;
  if (/kitchen|stove|oven|fridge|microwave|cook/.test(t)) return UtensilsCrossed;
  if (/park/.test(t)) return Car;
  if (/pool|hot tub|jacuzzi/.test(t)) return Waves;
  if (/wash|dry|laundr/.test(t)) return WashingMachine;
  if (/towel|bath|shower|bidet/.test(t)) return Bath;
  if (/safe|alarm|camera|extinguisher|first aid|detector/.test(t)) return ShieldCheck;
  if (/coffee|breakfast/.test(t)) return Coffee;
  if (/gym|fitness|workout/.test(t)) return Dumbbell;
  if (/garden|yard|balcony|patio|outdoor/.test(t)) return Trees;
  if (/bar|wine|drink/.test(t)) return Wine;
  if (/bed/.test(t)) return BedDouble;
  return Check;
}

function Tile({ icon: Icon, i }: { icon: LucideIcon; i: number }) {
  return (
    <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${ACCENTS[i % ACCENTS.length]}`}>
      <Icon size={20} strokeWidth={2.2} />
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-white/10 pt-7">
      <h2 className="text-2xl font-semibold text-white">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function ListingDetailView({ listing }: { listing: ListingRow }) {
  const d = listing.details ?? {};
  const photos = d.photos && d.photos.length ? d.photos : listing.image_url ? [listing.image_url] : [];
  const beds = d.whereYouWillSleep?.reduce((n, s) => n + (s.beds.match(/\d+/g)?.reduce((a, b) => a + Number(b), 0) || 1), 0);
  const hr = d.houseRules;
  // listing.amenities is the editable source of truth → it drives the amenities grid (reflects edits)
  const current = listing.amenities ?? [];

  return (
    <div className="space-y-7 text-white">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">{listing.title}</h1>
        <p className="mt-2 text-white/70">
          {listing.category} in {listing.city}, {listing.country} · {listing.max_guests || 1} guests ·{" "}
          {listing.bedrooms || 1} bedrooms{beds ? ` · ${beds} beds` : ""} · {listing.bathrooms || 1} baths
        </p>
      </header>

      <PhotoGallery photos={photos} title={listing.title} />

      {/* attached AI promo video — travels with the listing into publish · marketplace */}
      {listing.tour?.url && (
        <section>
          <h2 className="text-2xl font-semibold">Video tour</h2>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={listing.tour.url} poster={listing.tour.thumbnail ?? undefined} controls className="mt-4 w-full rounded-[24px] border border-white/10" />
        </section>
      )}

      {/* What makes it special — Pandio cream cards + pastel icon tiles */}
      {d.listingHighlights && d.listingHighlights.length > 0 && (
        <section>
          <h2 className="text-2xl font-semibold text-white">What makes it special</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {d.listingHighlights.map((h, i) => (
              <div key={i} className={`flex gap-4 p-5 ${CARD}`}>
                <Tile icon={highlightIcon(`${h.title} ${h.subtitle}`)} i={i} />
                <div>
                  <p className={TITLE}>{h.title}</p>
                  <p className={`mt-1 text-sm leading-relaxed ${TXT}`}>{h.subtitle}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <Section title="About this space">
        <div className={`${CARD} p-5`}>
          <p className={`whitespace-pre-line leading-relaxed ${BODY}`}>{listing.description}</p>
          {d.guestAccess && (
            <div className="mt-5 flex gap-4 border-t border-[#efe2d6] pt-5">
              <Tile icon={Home} i={2} />
              <div>
                <p className={TITLE}>Guest access</p>
                <p className={`mt-1 ${TXT}`}>{d.guestAccess}</p>
              </div>
            </div>
          )}
          {d.otherThingsToNote && d.otherThingsToNote.length > 0 && (
            <div className="mt-4 border-t border-[#efe2d6] pt-4">
              <p className={TITLE}>Other things to note</p>
              <ul className={`mt-1 list-disc space-y-1 pl-5 ${TXT}`}>{d.otherThingsToNote.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          )}
        </div>
        {d.idealFor && d.idealFor.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {d.idealFor.map((t, i) => (
              <span key={t} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${ACCENTS[i % ACCENTS.length]}`}>
                <Sparkles size={13} /> Ideal for {t}
              </span>
            ))}
          </div>
        )}
      </Section>

      {d.whereYouWillSleep && d.whereYouWillSleep.length > 0 && (
        <Section title="Where you'll sleep">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {d.whereYouWillSleep.map((s, i) => (
              <div key={i} className={`${CARD} p-4`}>
                <Tile icon={BedDouble} i={i} />
                <p className={`mt-3 ${TITLE}`}>{s.space}</p>
                <p className={`mt-1 text-sm ${TXT}`}>{s.beds}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {d.roomBreakdown && d.roomBreakdown.length > 0 && (
        <Section title="The space">
          <div className="grid gap-4 sm:grid-cols-2">
            {d.roomBreakdown.map((r, i) => (
              <div key={i} className={`${CARD} p-4`}>
                <div className="flex items-center gap-3">
                  <Tile icon={Building2} i={i} />
                  <p className={TITLE}>{r.name}</p>
                </div>
                <ul className={`mt-3 list-disc space-y-1 pl-5 text-sm ${TXT}`}>{r.details.map((x, j) => <li key={j}>{x}</li>)}</ul>
              </div>
            ))}
          </div>
        </Section>
      )}

      {current.length > 0 && (
        <Section title="What this place offers">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {current.map((a, i) => {
              const Icon = amenityIcon(a);
              return (
                <div key={a} className={`flex items-center gap-3 px-4 py-3 ${CARD}`}>
                  <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${ACCENTS[i % ACCENTS.length]}`}>
                    <Icon size={17} strokeWidth={2.2} />
                  </div>
                  <span className="text-sm font-medium text-[#312b27]">{a}</span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {d.locationHighlights && (
        <Section title="Where you'll be">
          <div className={`${CARD} p-5`}>
            <div className="flex items-center gap-3">
              <Tile icon={MapPin} i={3} />
              <p className={TITLE}>{listing.city}, {listing.country}</p>
            </div>
            {d.locationHighlights.gettingAround && <p className={`mt-3 ${TXT}`}>{d.locationHighlights.gettingAround}</p>}
            <div className="mt-4 grid gap-5 sm:grid-cols-3">
              {([["Attractions", d.locationHighlights.attractions], ["Dining", d.locationHighlights.dining], ["Transit", d.locationHighlights.transit]] as const).map(
                ([label, items], idx) =>
                  items && items.length > 0 ? (
                    <div key={label}>
                      <p className={`text-sm font-semibold ${["text-[#ef6d5b]", "text-[#d8932f]", "text-[#e0673f]"][idx]}`}>{label}</p>
                      <ul className={`mt-2 space-y-1 text-sm ${TXT}`}>{items.map((x) => <li key={x}>· {x}</li>)}</ul>
                    </div>
                  ) : null
              )}
            </div>
          </div>
        </Section>
      )}

      <Section title="Things to know">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className={`${CARD} p-4`}>
            <div className="flex items-center gap-3"><Tile icon={Home} i={0} /><p className={TITLE}>House rules</p></div>
            <ul className={`mt-3 space-y-1 text-sm ${TXT}`}>
              {hr?.checkIn && <li>Check-in: {hr.checkIn}</li>}
              {hr?.checkOut && <li>Checkout: {hr.checkOut}</li>}
              {hr?.smoking && <li>{hr.smoking}</li>}
              {hr?.pets && <li>Pets: {hr.pets}</li>}
              {hr?.additional?.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          </div>
          <div className={`${CARD} p-4`}>
            <div className="flex items-center gap-3"><Tile icon={ShieldCheck} i={2} /><p className={TITLE}>Safety &amp; property</p></div>
            <ul className={`mt-3 space-y-1 text-sm ${TXT}`}>
              {(d.safetyProperty && d.safetyProperty.length ? d.safetyProperty : ["See host for safety details"]).map((x, i) => <li key={i}>· {x}</li>)}
            </ul>
          </div>
          {d.unavailable && d.unavailable.length > 0 && (
            <div className={`${CARD} p-4`}>
              <div className="flex items-center gap-3"><Tile icon={Wind} i={1} /><p className={TITLE}>Not available</p></div>
              <ul className={`mt-3 space-y-1 text-sm ${MUTED}`}>{d.unavailable.map((x, i) => <li key={i}>· {x}</li>)}</ul>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
