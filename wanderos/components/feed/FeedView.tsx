"use client";

import { useState } from "react";
import Link from "next/link";
import { Compass, Users, Flame, BadgeCheck, Plus, Loader2, TrendingUp, ShieldCheck } from "lucide-react";
import { PostCard, type FeedPost } from "./PostCard";

const TABS = [
  { k: "for-you", label: "For You", Icon: Compass },
  { k: "following", label: "Following", Icon: Users },
  { k: "trending", label: "Trending", Icon: Flame },
  { k: "verified", label: "Verified", Icon: BadgeCheck }
] as const;

const TRENDING = ["tokyo", "santorini", "bali", "dubai", "kyoto", "lisbon", "reykjavik", "marrakech"];

/** Structured feed — ranked tabs + cards in the main column, a sticky discovery rail on the right. */
export function FeedView({ initialPosts, viewerId }: { initialPosts: FeedPost[]; viewerId?: string }) {
  const [tab, setTab] = useState("for-you");
  const [posts, setPosts] = useState(initialPosts);
  const [loading, setLoading] = useState(false);

  async function load(t: string) {
    setTab(t); setLoading(true);
    const r = await fetch(`/api/feed?tab=${t}&limit=24`);
    const j = (await r.json().catch(() => ({}))) as { posts?: FeedPost[] };
    setPosts(j.posts ?? []); setLoading(false);
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      {/* ── main column ── */}
      <div className="min-w-0">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">Explore</h1>
            <p className="text-sm text-white/50">Real stays, shared by travelers.</p>
          </div>
          <Link href="/posts/new" className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-coral to-mist px-4 py-2.5 text-sm font-semibold text-night shadow-[0_8px_24px_rgba(239,109,91,0.35)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_34px_rgba(239,109,91,0.5)]">
            <Plus size={16} /> Create
          </Link>
        </div>

        <div className="mb-6 flex gap-1 rounded-2xl border border-white/10 bg-white/5 p-1">
          {TABS.map(({ k, label, Icon }) => (
            <button key={k} onClick={() => load(k)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition ${tab === k ? "bg-gradient-to-r from-coral to-mist text-night shadow-[0_8px_22px_rgba(239,109,91,0.4)]" : "text-white/60 hover:bg-white/5 hover:text-white"}`}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-16 text-white/40"><Loader2 className="animate-spin" /></div>
        ) : posts.length ? (
          <div className="space-y-6">{posts.map((p, i) => (
            <div key={p.id} className="animate-fade-up" style={{ animationDelay: `${Math.min(i, 6) * 70}ms` }}>
              <PostCard post={p} viewerId={viewerId} onDeleted={(id) => setPosts((x) => x.filter((q) => q.id !== id))} />
            </div>
          ))}</div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
            <p className="text-white/55">No posts here yet.</p>
            <Link href="/posts/new" className="mt-3 inline-block text-sm font-semibold text-coral">Share your trip →</Link>
          </div>
        )}
      </div>

      {/* ── right discovery rail ── */}
      <aside className="hidden space-y-5 lg:block">
        <div className="sticky top-6 space-y-5">
          <div className="animate-glow rounded-2xl border border-white/10 bg-gradient-to-br from-coral/15 to-mist/10 p-5">
            <h3 className="font-semibold text-white">Share your journey</h3>
            <p className="mt-1 text-sm text-white/60">Photos + a clip → AI writes the caption.</p>
            <Link href="/posts/new" className="mt-3 inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-sm font-semibold text-night transition hover:bg-white/90"><Plus size={15} /> Create a post</Link>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h3 className="flex items-center gap-2 font-semibold text-white"><TrendingUp size={16} className="text-coral" /> Trending now</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {TRENDING.map((t) => <span key={t} className="rounded-full border border-white/10 bg-white/8 px-2.5 py-1 text-xs text-white/70">#{t}</span>)}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h3 className="flex items-center gap-2 font-semibold text-white"><ShieldCheck size={16} className="text-aurora" /> Verified stays</h3>
            <p className="mt-1.5 text-sm text-white/60">A ✅ badge means the traveler actually booked that stay on WanderOS — real, trustworthy social proof.</p>
          </div>
        </div>
      </aside>
    </div>
  );
}
