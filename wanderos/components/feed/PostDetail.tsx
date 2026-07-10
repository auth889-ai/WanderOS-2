"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PostCard } from "./PostCard";
import { CommentThread } from "./CommentThread";
import { Lightbox, type LightboxItem } from "./Lightbox";
import type { FeedPost, PostMedia } from "./types";

/** Single post page — back link · full media gallery (open ALL photos) · the card · comments. */
export function PostDetail({ post, media, viewerId }: { post: FeedPost; media: PostMedia[]; viewerId?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const gallery = (media ?? []).filter((m) => m.media_url);
  const items: LightboxItem[] = gallery.map((m) => ({ url: m.media_url, kind: m.media_kind === "video" || m.media_kind === "reel" ? "video" : "photo" }));

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <Link href="/feed" className="inline-flex items-center gap-2 text-sm font-semibold text-white/70 transition hover:text-white">
        <ArrowLeft size={16} /> Feed
      </Link>

      {/* full gallery — click any to open ALL photos */}
      {gallery.length > 1 && (
        <div className="grid grid-cols-3 gap-2">
          {gallery.map((m, i) => (
            <button key={m.id} onClick={() => setOpen(i)} className="relative overflow-hidden rounded-xl">
              {m.media_kind === "video" || m.media_kind === "reel"
                ? <video src={m.media_url} className="aspect-square w-full object-cover" muted playsInline />
                // eslint-disable-next-line @next/next/no-img-element
                : <img src={m.media_url} alt="" className="aspect-square w-full object-cover transition hover:brightness-90" />}
            </button>
          ))}
        </div>
      )}

      <PostCard post={post} viewerId={viewerId} />
      <CommentThread postId={post.id} />

      <Lightbox items={open !== null ? items : null} startIndex={open ?? 0} onClose={() => setOpen(null)} />
    </div>
  );
}
