"use client";

import { useState } from "react";
import Link from "next/link";
import { Field, inputClass } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { AmenitiesGrid } from "./AmenitiesGrid";
import { LivePreview } from "./LivePreview";
import type { ListingRow } from "@/lib/api/host-listings";

/** Review + edit the AI draft. Edits commit on blur via onSave; publish via onPublish. */
export function DraftReview({ listing, error, onSave, onPublish }: { listing: ListingRow; error: string; onSave: (patch: Record<string, unknown>) => void; onPublish: () => void }) {
  const [title, setTitle] = useState(listing.title);
  const [description, setDescription] = useState(listing.description);
  const [price, setPrice] = useState(Number(listing.price));
  const [amenities, setAmenities] = useState(listing.amenities ?? []);

  const d = listing.details ?? {};
  const highlights = d.listingHighlights ?? [];
  const rooms = d.roomBreakdown ?? [];
  const attractions = d.locationHighlights?.attractions ?? [];
  const submitted = listing.status === "pending_review" || listing.status === "published";

  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_0.8fr]">
      <section className="glass space-y-6 rounded-[28px] p-7">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-mist">Your AI draft</p>
            <h2 className="mt-1 text-3xl font-semibold">Review &amp; edit anything</h2>
          </div>
          {submitted && <span className="rounded-full border border-mist/40 bg-mist/10 px-3 py-1 text-xs text-white">Pending review</span>}
        </div>

        <Field label="Title"><input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => onSave({ title })} /></Field>
        <Field label="Description"><textarea className={`${inputClass} min-h-44`} value={description} onChange={(e) => setDescription(e.target.value)} onBlur={() => onSave({ description })} /></Field>
        <div className="max-w-48"><Field label="Price / night"><input type="number" className={inputClass} value={price} onChange={(e) => setPrice(Number(e.target.value))} onBlur={() => onSave({ price })} /></Field></div>

        <Field label="Amenities" hint="AI-detected — tap to toggle">
          <AmenitiesGrid selected={amenities} onChange={(next) => { setAmenities(next); onSave({ amenities: next }); }} />
        </Field>

        {error && <p className="rounded-xl border border-coral/40 bg-coral/10 px-4 py-3 text-sm text-peach">{error}</p>}

        <div className="flex flex-wrap items-center gap-4">
          <Button onClick={onPublish} disabled={submitted} className="text-base">
            {submitted ? "Submitted for review ✓" : "Publish for review"}
          </Button>
          <Link href={`/host/listings/${listing.id}`} className="text-sm font-semibold text-mist hover:text-white">
            View full listing page →
          </Link>
        </div>
      </section>

      <div className="space-y-6">
        <LivePreview
          data={{
            cover: listing.image_url ?? undefined,
            title,
            city: listing.city,
            country: listing.country,
            price,
            guests: listing.max_guests,
            bedrooms: listing.bedrooms,
            bathrooms: listing.bathrooms,
            amenities,
            description
          }}
        />

        {(highlights.length > 0 || rooms.length > 0 || attractions.length > 0) && (
          <div className="glass rounded-[28px] p-6">
            <p className="text-xs uppercase tracking-[0.22em] text-mist">Premium detail (AI-generated)</p>
            {highlights.length > 0 && (
              <div className="mt-3 space-y-2">
                {highlights.slice(0, 4).map((h, i) => (
                  <div key={i} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5">
                    <p className="text-sm font-semibold">{h.title}</p>
                    {h.subtitle && <p className="text-xs text-white/60">{h.subtitle}</p>}
                  </div>
                ))}
              </div>
            )}
            {rooms.length > 0 && (
              <div className="mt-4">
                <p className="text-xs uppercase tracking-[0.18em] text-aurora">The space</p>
                <ul className="mt-2 space-y-1 text-sm text-white/70">{rooms.slice(0, 6).map((r) => <li key={r.name}>· {r.name}</li>)}</ul>
              </div>
            )}
            {attractions.length > 0 && (
              <div className="mt-4">
                <p className="text-xs uppercase tracking-[0.18em] text-aurora">Nearby</p>
                <p className="mt-1 text-sm text-white/70">{attractions.slice(0, 4).join(" · ")}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
