/** Client-side post API calls — single responsibility: talk to /api/posts. */
export type DraftBody = {
  title: string; location: string | null; listingId: string | null; mood: string;
  tags?: string[]; postType: string; media: { mediaUrl: string; mediaKind: string; sortOrder: number }[];
};

export async function uploadPostMedia(file: File): Promise<string | null> {
  const fd = new FormData(); fd.append("file", file);
  const r = await fetch("/api/posts/uploads", { method: "POST", body: fd });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return (j.url || j.secure_url || (j.media as { mediaUrl?: string })?.mediaUrl || j.mediaUrl || null) as string | null;
}
export async function createDraftPost(body: DraftBody): Promise<string | null> {
  const r = await fetch("/api/posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as { post?: { id: string } };
  return r.ok ? j.post?.id ?? null : null;
}
export async function composePost(id: string): Promise<void> { await fetch(`/api/posts/${id}/compose`, { method: "POST" }).catch(() => {}); }
export async function getPost(id: string): Promise<{ caption: string; tags: string[] } | null> {
  const r = await fetch(`/api/posts/${id}`, { cache: "no-store" });
  const j = (await r.json().catch(() => ({}))) as { post?: { caption?: string; tags?: string[] } };
  return j.post ? { caption: j.post.caption ?? "", tags: j.post.tags ?? [] } : null;
}
export async function publishPost(id: string): Promise<boolean> { return (await fetch(`/api/posts/${id}/publish`, { method: "POST" })).ok; }

export type Comment = { id: string; author_name?: string | null; user_id: string; parent_id: string | null; body: string; created_at: string };

export async function reactPost(id: string, kind: string, on: boolean): Promise<void> {
  await fetch(`/api/posts/${id}/react`, { method: on ? "POST" : "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) }).catch(() => {});
}
export async function savePostToggle(id: string, on: boolean): Promise<void> {
  await fetch(`/api/posts/${id}/save`, { method: on ? "POST" : "DELETE", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
}
export async function deletePost(id: string): Promise<boolean> { return (await fetch(`/api/posts/${id}`, { method: "DELETE" })).ok; }
export async function setPostVisibility(id: string, visibility: "public" | "private"): Promise<boolean> {
  return (await fetch(`/api/posts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visibility }) })).ok;
}
export async function getComments(id: string): Promise<Comment[]> {
  const r = await fetch(`/api/posts/${id}/comment`); const j = (await r.json().catch(() => ({}))) as { comments?: Comment[] }; return j.comments ?? [];
}
export async function addComment(id: string, body: string, parentId?: string | null): Promise<Comment | null> {
  const r = await fetch(`/api/posts/${id}/comment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body, parentId: parentId ?? null }) });
  const j = (await r.json().catch(() => ({}))) as { comment?: Comment }; return r.ok ? j.comment ?? null : null;
}

/** Direct-to-Cloudinary VIDEO upload (any size) — bypasses the serverless body limit, returns a
 *  compressed delivery URL (q_auto · capped width · auto codec). Falls back to null on failure. */
export async function uploadVideoDirect(file: File): Promise<string | null> {
  const sigRes = await fetch("/api/posts/uploads/sign", { method: "POST" });
  if (!sigRes.ok) return null;
  const { cloudName, apiKey, timestamp, folder, signature } = (await sigRes.json()) as Record<string, string>;
  const fd = new FormData();
  fd.append("file", file);
  fd.append("api_key", apiKey);
  fd.append("timestamp", String(timestamp));
  fd.append("folder", folder);
  fd.append("signature", signature);
  const up = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, { method: "POST", body: fd });
  if (!up.ok) return null;
  const j = (await up.json()) as { secure_url?: string };
  if (!j.secure_url) return null;
  // compressed, web-optimized delivery (q_auto, auto codec, ≤1280 wide)
  return j.secure_url.replace("/upload/", "/upload/q_auto,vc_auto,w_1280,c_limit/");
}

export async function followUser(followingId: string, on: boolean): Promise<void> {
  await fetch("/api/follow", { method: on ? "POST" : "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ followingId }) }).catch(() => {});
}
export async function editPostCaption(id: string, caption: string): Promise<boolean> {
  return (await fetch(`/api/posts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caption }) })).ok;
}
