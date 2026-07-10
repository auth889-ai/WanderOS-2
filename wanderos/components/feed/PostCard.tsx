"use client";

import { useState } from "react";
import Link from "next/link";
import { MessageCircle, Bookmark, MapPin, BadgeCheck, Hotel, MoreHorizontal, Trash2, Eye, EyeOff, Pencil, UserPlus, UserCheck } from "lucide-react";
import { ReactionBar } from "./ReactionBar";
import { Lightbox } from "./Lightbox";
import { savePostToggle, deletePost, setPostVisibility, followUser, editPostCaption } from "@/lib/api/posts-client";
import type { FeedPost } from "./types";

export type { FeedPost };

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Premium post card (Pandio cream theme) — reactions · comment · save · lightbox · owner controls · stay-here. */
export function PostCard({ post, viewerId, onDeleted }: { post: FeedPost; viewerId?: string; onDeleted?: (id: string) => void }) {
  const [saved, setSaved] = useState(false);
  const [menu, setMenu] = useState(false);
  const [vis, setVis] = useState(post.visibility ?? "public");
  const [lbOpen, setLbOpen] = useState(false);
  const [following, setFollowing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cap, setCap] = useState(post.caption ?? "");
  const author = post.author_name || "Traveler";
  const isOwner = !!viewerId && post.author_id === viewerId;
  const isVideo = post.post_type === "reel" || (!!post.media_url && /\.(mp4|webm|mov)/i.test(post.media_url));

  async function save() { const n = !saved; setSaved(n); await savePostToggle(post.id, n); }
  async function del() { if (await deletePost(post.id)) onDeleted?.(post.id); }
  async function toggleVis() { const n = vis === "public" ? "private" : "public"; setVis(n); setMenu(false); await setPostVisibility(post.id, n); }
  async function follow() { const n = !following; setFollowing(n); if (post.author_id) await followUser(post.author_id, n); }
  async function saveCaption() { setEditing(false); await editPostCaption(post.id, cap); }

  return (
    <article className="card-rise overflow-hidden rounded-[20px] border border-[#f0e6dc] bg-white shadow-[0_8px_30px_rgba(20,12,8,0.05)]">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="grid h-10 w-10 place-items-center rounded-full bg-[#fce2dc] text-sm font-bold text-[#ef6d5b]">{author.slice(0, 1).toUpperCase()}</div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-[#312b27]">
            {author}
            {post.verified_stay && <span className="inline-flex items-center gap-1 rounded-full bg-[#dcefe0] px-1.5 py-0.5 text-[10px] font-medium text-[#2f8a52]"><BadgeCheck size={11} /> Verified stay</span>}
          </p>
          <p className="flex items-center gap-1 text-xs text-[#8a7e76]">{post.location && <><MapPin size={11} /> {post.location} · </>}{timeAgo(post.created_at)}</p>
        </div>
        {!isOwner && post.author_id && (
          <button onClick={follow} className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition ${following ? "border border-[#f0e6dc] text-[#8a7e76]" : "bg-[#ef6d5b] text-white hover:brightness-105"}`}>
            {following ? <><UserCheck size={13} /> Following</> : <><UserPlus size={13} /> Follow</>}
          </button>
        )}
        {isOwner && (
          <div className="relative">
            <button onClick={() => setMenu((m) => !m)} className="grid h-8 w-8 place-items-center rounded-full text-[#8a7e76] hover:bg-[#faf3ec]"><MoreHorizontal size={18} /></button>
            {menu && (
              <div className="absolute right-0 top-9 z-10 w-48 overflow-hidden rounded-xl border border-[#f0e6dc] bg-white shadow-lg">
                <button onClick={() => { setEditing(true); setMenu(false); }} className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-[#312b27] hover:bg-[#faf3ec]"><Pencil size={15} /> Edit caption</button>
                <button onClick={toggleVis} className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-[#312b27] hover:bg-[#faf3ec]">{vis === "public" ? <EyeOff size={15} /> : <Eye size={15} />} Make {vis === "public" ? "private" : "public"}</button>
                <button onClick={del} className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-[#c0503f] hover:bg-[#f9e3df]"><Trash2 size={15} /> Delete post</button>
              </div>
            )}
          </div>
        )}
      </div>

      {post.media_url && (
        <button onClick={() => setLbOpen(true)} className="block w-full">
          {isVideo
            ? <video src={post.media_url} className="media-zoom aspect-square w-full bg-black object-cover" muted playsInline />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={post.media_url} alt={post.title} className="media-zoom aspect-square w-full object-cover" />}
        </button>
      )}

      <div className="flex items-center gap-5 px-4 pt-3">
        <ReactionBar postId={post.id} initialCount={post.like_count} />
        <Link href={`/posts/${post.id}`} className="flex items-center gap-1.5 text-sm font-medium text-[#8a7e76] hover:text-[#312b27]"><MessageCircle size={19} /> {post.comment_count > 0 && post.comment_count}</Link>
        <button onClick={save} className={`ml-auto transition ${saved ? "text-[#ef6d5b]" : "text-[#8a7e76] hover:text-[#312b27]"}`}><Bookmark size={19} fill={saved ? "currentColor" : "none"} /></button>
      </div>

      <div className="px-4 pb-3 pt-2">
        {editing ? (
          <div className="space-y-2">
            <textarea className="w-full rounded-xl border border-[#f0e6dc] bg-[#fdf8f3] px-3 py-2 text-sm text-[#312b27] outline-none focus:border-[#ef6d5b]" rows={3} value={cap} onChange={(e) => setCap(e.target.value)} />
            <div className="flex gap-2">
              <button onClick={saveCaption} className="rounded-lg bg-[#ef6d5b] px-3 py-1.5 text-sm font-semibold text-white">Save</button>
              <button onClick={() => { setEditing(false); setCap(post.caption ?? ""); }} className="rounded-lg border border-[#f0e6dc] px-3 py-1.5 text-sm text-[#8a7e76]">Cancel</button>
            </div>
          </div>
        ) : (
          cap && <p className="whitespace-pre-line text-sm leading-relaxed text-[#4a423b]"><span className="font-semibold text-[#312b27]">{author}</span> {cap}</p>
        )}
        {post.tags?.length > 0 && <p className="mt-1.5 flex flex-wrap gap-x-2 text-sm text-[#ef6d5b]">{post.tags.slice(0, 6).map((t) => <span key={t}>#{t.replace(/^#/, "")}</span>)}</p>}
      </div>

      {post.listing_id && (
        <Link href={`/listing/${post.listing_id}`} className="flex items-center justify-between gap-2 border-t border-[#f0e6dc] bg-[#fdf3f0] px-4 py-3 text-sm font-semibold text-[#312b27] transition hover:bg-[#fce8e3]">
          <span className="flex items-center gap-2"><Hotel size={16} className="text-[#ef6d5b]" /> Stay where they stayed</span>
          <span className="text-[#ef6d5b]">Book →</span>
        </Link>
      )}

      <Lightbox items={lbOpen && post.media_url ? [{ url: post.media_url, kind: isVideo ? "video" : "photo" }] : null} startIndex={0} onClose={() => setLbOpen(false)} />
    </article>
  );
}
