"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil, Check, Trash2 } from "lucide-react";
import { Field, inputClass } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { AmenitiesGrid } from "./AmenitiesGrid";
import { editListing, publishListing, deleteListing, type ListingRow } from "@/lib/api/host-listings";

const STATUS: Record<string, string> = {
  draft: "Draft", editing: "Editing", pending_review: "Pending admin review", approved: "Approved", published: "Published", archived: "Archived"
};

/** Top action bar for the detail page (price · status · Edit · Publish · Delete) + an inline edit panel
 *  so the host can edit ANY TIME. Saving PATCHes via the API and refreshes the server-rendered detail. */
export function ListingHeaderActions({ listing, currency }: { listing: ListingRow; currency: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(listing.status);

  const [title, setTitle] = useState(listing.title);
  const [description, setDescription] = useState(listing.description);
  const [price, setPrice] = useState(Number(listing.price));
  const [amenities, setAmenities] = useState(listing.amenities ?? []);

  const submitted = status === "pending_review" || status === "approved" || status === "published";

  async function save() {
    setBusy(true);
    setError("");
    try {
      await editListing(listing.id, { title, description, price, amenities });
      setEditing(false);
      router.refresh(); // re-render the server detail with the saved values
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    setBusy(true);
    setError("");
    try {
      const l = await publishListing(listing.id);
      setStatus(l.status);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await deleteListing(listing.id);
      router.push("/host/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setBusy(false);
    }
  }

  return (
    <div className="glass mb-6 rounded-[24px] p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-bold">{price ? price.toLocaleString() : 0}<span className="ml-1 text-sm font-normal text-white/55">{currency} / night</span></span>
          <span className="rounded-full border border-white/15 bg-white/8 px-3 py-1 text-xs text-white/75">{STATUS[status] ?? status}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => setEditing((v) => !v)} className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10">
            <Pencil size={15} /> {editing ? "Close editor" : "Edit listing"}
          </button>
          <Button onClick={publish} disabled={busy || submitted} className="inline-flex items-center gap-2 px-5 py-2.5">
            <Check size={15} /> {submitted ? "Submitted ✓" : "Publish for review"}
          </Button>
          <Link href="/host/listings/new" className="rounded-2xl border border-white/12 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10">Create another</Link>
          <button onClick={remove} disabled={busy} className="inline-flex items-center gap-1.5 rounded-2xl px-3 py-2.5 text-sm text-white/45 transition hover:text-coral">
            <Trash2 size={15} /> Delete
          </button>
        </div>
      </div>

      {error && <p className="mt-3 rounded-xl border border-coral/40 bg-coral/10 px-3 py-2 text-sm text-peach">{error}</p>}

      {editing && (
        <div className="mt-5 space-y-5 border-t border-white/10 pt-5">
          <p className="text-xs uppercase tracking-[0.2em] text-mist">Edit anytime — changes save to your listing</p>
          <Field label="Title"><input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Description"><textarea className={`${inputClass} min-h-40`} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <div className="max-w-48"><Field label="Price / night"><input type="number" className={inputClass} value={price} onChange={(e) => setPrice(Number(e.target.value))} /></Field></div>
          <Field label="Amenities" hint="AI-detected — add/remove freely"><AmenitiesGrid selected={amenities} onChange={setAmenities} /></Field>
          <div className="flex gap-3">
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
            <button onClick={() => setEditing(false)} className="rounded-2xl border border-white/12 bg-white/5 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
