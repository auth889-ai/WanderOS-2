"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, X, Trash2, ExternalLink, Search, Film } from "lucide-react";

export type AdminListing = {
  id: string;
  title: string;
  city: string;
  country: string;
  category: string;
  host_name?: string | null;
  image_url: string | null;
  moderation_status: string;
  price: number;
  status: string;
  has_video?: boolean;
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "pending_review", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" }
];
const BADGE: Record<string, string> = {
  pending_review: "bg-[#fbecd6] text-[#b87d1f]",
  approved: "bg-[#dcefe0] text-[#2f8a52]",
  rejected: "bg-[#f3d6d2] text-[#c0503f]"
};

/** Admin moderation table — filter · search · Approve / Reject / Delete / View (full CRUD, Pandio light theme). */
export function AdminModeration({ initial }: { initial: AdminListing[] }) {
  const [rows, setRows] = useState(initial);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const counts = useMemo(() => ({
    all: rows.length,
    pending_review: rows.filter((r) => r.moderation_status === "pending_review").length,
    approved: rows.filter((r) => r.moderation_status === "approved").length,
    rejected: rows.filter((r) => r.moderation_status === "rejected").length
  }), [rows]);

  const visible = rows.filter((r) =>
    (filter === "all" || r.moderation_status === filter) &&
    (query === "" || `${r.title} ${r.city} ${r.host_name ?? ""}`.toLowerCase().includes(query.toLowerCase()))
  );

  async function moderate(id: string, status: "approved" | "rejected") {
    setBusy(id);
    const r = await fetch("/api/admin/listings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId: id, status }) });
    if (r.ok) setRows((rs) => rs.map((x) => (x.id === id ? { ...x, moderation_status: status } : x)));
    setBusy(null);
  }
  async function remove(id: string) {
    setBusy(id);
    const r = await fetch(`/api/admin/listings?id=${id}`, { method: "DELETE" });
    if (r.ok) setRows((rs) => rs.filter((x) => x.id !== id));
    setBusy(null);
  }

  return (
    <div className="rounded-2xl border border-[#f0e6dc] bg-white p-5 shadow-[0_10px_34px_rgba(20,12,8,0.05)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl bg-[#faf3ec] p-1">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${filter === f.key ? "bg-[#ef6d5b] text-white" : "text-[#8a7e76] hover:text-[#312b27]"}`}>
              {f.label} <span className="opacity-70">{counts[f.key as keyof typeof counts]}</span>
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#b3a89f]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, city, host"
            className="w-64 rounded-xl border border-[#f0e6dc] bg-[#fdf8f3] py-2 pl-9 pr-3 text-sm text-[#312b27] outline-none focus:border-[#ef6d5b]" />
        </div>
      </div>

      <div className="mt-4 divide-y divide-[#f3ece3]">
        {visible.map((l) => (
          <div key={l.id} className="flex items-center gap-4 py-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {l.image_url ? <img src={l.image_url} alt="" className="h-14 w-20 shrink-0 rounded-lg object-cover" /> : <div className="h-14 w-20 shrink-0 rounded-lg bg-[#f3ece3]" />}
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 truncate font-semibold text-[#312b27]">
                {l.title}
                {l.has_video && <span className="inline-flex items-center gap-1 rounded-full bg-[#fce2dc] px-2 py-0.5 text-[10px] font-medium text-[#ef6d5b]"><Film size={10} /> video</span>}
              </p>
              <p className="truncate text-sm text-[#8a7e76]">{l.category} · {l.city}, {l.country} · {l.host_name || "Host"} · {l.price.toLocaleString()}/night</p>
            </div>
            <span className={`hidden rounded-full px-2.5 py-1 text-xs font-medium sm:inline ${BADGE[l.moderation_status] ?? "bg-[#f3ece3] text-[#8a7e76]"}`}>{l.moderation_status.replace("_", " ")}</span>
            <div className="flex items-center gap-1.5">
              <Link href={`/listing/${l.id}`} target="_blank" className="grid h-8 w-8 place-items-center rounded-lg border border-[#f0e6dc] text-[#8a7e76] hover:bg-[#faf3ec]" title="View"><ExternalLink size={14} /></Link>
              {l.moderation_status !== "approved" && (
                <button onClick={() => moderate(l.id, "approved")} disabled={busy === l.id} className="inline-flex items-center gap-1 rounded-lg bg-[#ef6d5b] px-3 py-1.5 text-sm font-semibold text-white transition hover:brightness-105"><Check size={14} /> Approve</button>
              )}
              {l.moderation_status !== "rejected" && (
                <button onClick={() => moderate(l.id, "rejected")} disabled={busy === l.id} className="inline-flex items-center gap-1 rounded-lg border border-[#f0e6dc] px-3 py-1.5 text-sm text-[#8a7e76] transition hover:bg-[#faf3ec]"><X size={14} /> Reject</button>
              )}
              <button onClick={() => remove(l.id)} disabled={busy === l.id} className="grid h-8 w-8 place-items-center rounded-lg text-[#c0503f] hover:bg-[#f9e3df]" title="Delete"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
        {visible.length === 0 && <p className="py-8 text-center text-sm text-[#8a7e76]">No listings match.</p>}
      </div>
    </div>
  );
}
