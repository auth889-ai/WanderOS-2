"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { MediaUploader, type Media } from "./composer/MediaUploader";
import { MoodPicker } from "./composer/MoodPicker";
import { TagInput } from "./composer/TagInput";
import { ComposeReview } from "./composer/ComposeReview";
import { uploadPostMedia, uploadVideoDirect, createDraftPost, composePost, getPost, publishPost } from "@/lib/api/posts-client";

type Booking = { listing_id: string; title: string; city: string };
const inputCls = "w-full rounded-xl border border-white/12 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-coral";

/** AI post creator (orchestrator) — composes focused sub-components + the compose flow. */
export function Composer({ bookings }: { bookings: Booking[] }) {
  const router = useRouter();
  const [media, setMedia] = useState<Media[]>([]);
  const [uploading, setUploading] = useState(false);
  const [location, setLocation] = useState("");
  const [listingId, setListingId] = useState("");
  const [mood, setMood] = useState("joyful");
  const [tags, setTags] = useState<string[]>([]);
  const [phase, setPhase] = useState<"idle" | "composing" | "review">("idle");
  const [draftId, setDraftId] = useState("");
  const [caption, setCaption] = useState("");
  const [aiTags, setAiTags] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const postType = media.some((m) => m.kind === "video") ? "reel" : media.length > 1 ? "carousel" : "photo";

  async function onFiles(files: File[]) {
    if (!files.length) return;
    setUploading(true); setError("");
    for (const f of files) {
      const isVid = /video/.test(f.type);
      const url = isVid ? await uploadVideoDirect(f) : await uploadPostMedia(f); // videos go direct → any size + compressed
      if (url) setMedia((m) => [...m, { url, kind: isVid ? "video" : "photo" }]);
      else setError(isVid ? "Video upload failed — try a shorter clip." : "Photo upload failed.");
    }
    setUploading(false);
  }

  async function generate() {
    if (!media.length) { setError("Add at least one photo."); return; }
    setBusy(true); setError(""); setPhase("composing"); setStatus("Creating your post…");
    const id = await createDraftPost({
      title: location || "My trip", location: location || null, listingId: listingId || null, mood,
      tags: tags.length ? tags : undefined, postType,
      media: media.map((m, i) => ({ mediaUrl: m.url, mediaKind: m.kind === "video" ? "reel" : "photo", sortOrder: i }))
    });
    if (!id) { setError("Could not create post"); setBusy(false); setPhase("idle"); return; }
    setDraftId(id); setStatus("AI is composing your post…");
    await composePost(id);
    const es = new EventSource(`/api/posts/${id}/stream`);
    es.onmessage = async (ev) => {
      try {
        const d = JSON.parse(ev.data) as { stage?: string; status?: string; progress?: number };
        if (d.stage) setStatus(d.stage);
        if (d.status === "succeeded" || (d.progress ?? 0) >= 100) { es.close(); await loadDraft(id); }
      } catch { /* keep */ }
    };
    es.onerror = () => { es.close(); loadDraft(id); };
  }

  async function loadDraft(id: string) {
    const p = await getPost(id);
    if (p) { setCaption(p.caption); setAiTags(p.tags.length ? p.tags : tags); }
    setPhase("review"); setBusy(false);
  }

  async function publish() {
    setBusy(true);
    if (await publishPost(draftId)) router.push("/feed");
    else { setError("Could not publish"); setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-2xl text-white">
      <h1 className="text-3xl font-bold">Share your trip</h1>
      <p className="mt-1 text-sm text-white/50">Drop your photos — AI writes a scroll-stopping caption. Link a booked stay for a ✅ Verified badge.</p>
      {error && <p className="mt-4 rounded-xl border border-coral/40 bg-coral/10 px-3 py-2 text-sm text-peach">{error}</p>}

      {phase === "composing" ? (
        <div className="mt-8 flex flex-col items-center gap-3 rounded-[20px] border border-white/10 bg-white/[0.04] py-14 text-center backdrop-blur-xl">
          <Loader2 className="animate-spin text-coral" size={28} />
          <p className="font-semibold">{status}</p>
          <p className="text-sm text-white/45">shot-vision → caption-writer → tagger → moderation</p>
        </div>
      ) : phase === "review" ? (
        <ComposeReview media={media} caption={caption} onCaption={setCaption} tags={aiTags} busy={busy} onPublish={publish} onBack={() => setPhase("idle")} />
      ) : (
        <div className="mt-6 space-y-5">
          <MediaUploader media={media} uploading={uploading} postType={postType} onFiles={onFiles} onRemove={(i) => setMedia((m) => m.filter((_, j) => j !== i))} />
          <MoodPicker value={mood} onChange={setMood} />
          <div className="space-y-4 rounded-[20px] border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl">
            <label className="block text-sm font-semibold">Location
              <div className="relative mt-2"><MapPin size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                <input className={`${inputCls} pl-9`} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Dubai Marina, UAE" /></div>
            </label>
            <TagInput tags={tags} onChange={setTags} />
            {bookings.length > 0 && (
              <label className="block text-sm font-semibold">Link a stay you booked <span className="font-normal text-aurora">→ ✅ Verified</span>
                <select className={`${inputCls} mt-2`} value={listingId} onChange={(e) => setListingId(e.target.value)}>
                  <option value="">— none —</option>
                  {bookings.map((b) => <option key={b.listing_id} value={b.listing_id}>{b.title} · {b.city}</option>)}
                </select>
              </label>
            )}
          </div>
          <Button onClick={generate} disabled={busy || !media.length} className="inline-flex w-full items-center justify-center gap-2 py-3.5"><Sparkles size={18} /> Compose with AI</Button>
        </div>
      )}
    </div>
  );
}
