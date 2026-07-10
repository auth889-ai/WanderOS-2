"use client";

import { useState } from "react";
import { Field, inputClass } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { PhotoUploader } from "./PhotoUploader";
import { LivePreview } from "./LivePreview";
import type { StartDraftBody } from "@/lib/api/host-listings";

const CATEGORIES = ["apartment", "villa", "house", "cottage", "hotel", "cabin", "studio"];
const VIDEO_MODES = ["walkthrough", "day-to-dusk", "staging-reveal", "drone", "social-reel"];

/** The brief: photos + property info, with a live card preview. Emits a complete StartDraftBody. */
export function BriefForm({ onGenerate }: { onGenerate: (body: StartDraftBody) => void }) {
  const [photos, setPhotos] = useState<string[]>([]);
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [category, setCategory] = useState("apartment");
  const [notes, setNotes] = useState("");
  const [videoMode, setVideoMode] = useState("walkthrough");
  const [error, setError] = useState("");

  function submit() {
    if (photos.length === 0 || !city || !country) {
      setError("Add at least one photo, a city and a country.");
      return;
    }
    setError("");
    onGenerate({ city, country, category, notes, photos, videoMode });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_0.8fr]">
      <section className="glass space-y-6 rounded-[28px] p-7">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-mist">AI Listing Studio</p>
          <h2 className="mt-1 text-3xl font-semibold">Tell the crew about your place</h2>
          <p className="mt-2 text-white/60">Upload photos and a few notes. The AI writes the copy, prices it from real comparables, and builds an Airbnb-grade detail page.</p>
        </div>

        <Field label="Photos" hint="up to 30 — drag & drop">
          <PhotoUploader photos={photos} onChange={setPhotos} />
        </Field>

        <div className="grid gap-5 md:grid-cols-2">
          <Field label="City"><input className={inputClass} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Dubai" /></Field>
          <Field label="Country"><input className={inputClass} value={country} onChange={(e) => setCountry(e.target.value)} placeholder="United Arab Emirates" /></Field>
          <Field label="Property type">
            <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c} className="bg-night capitalize">{c}</option>)}
            </select>
          </Field>
          <Field label="Promo video style">
            <select className={inputClass} value={videoMode} onChange={(e) => setVideoMode(e.target.value)}>
              {VIDEO_MODES.map((m) => <option key={m} value={m} className="bg-night">{m}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Notes" hint="what makes it special">
          <textarea className={`${inputClass} min-h-32`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Skyline views, floor-to-ceiling windows, designer bathroom, no smoking…" />
        </Field>

        {error && <p className="rounded-xl border border-coral/40 bg-coral/10 px-4 py-3 text-sm text-peach">{error}</p>}

        <Button onClick={submit} className="w-full text-base">✦ Generate my listing with AI</Button>
      </section>

      <LivePreview data={{ cover: photos[0], city, country, description: "Add photos and notes, then the crew writes your premium listing." }} />
    </div>
  );
}
