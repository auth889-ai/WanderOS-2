"use client";
import { useEffect, useMemo, useState } from "react";
import { Send, CornerDownRight } from "lucide-react";
import { getComments, addComment, type Comment } from "@/lib/api/posts-client";

function ago(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now"; if (s < 3600) return `${Math.floor(s / 60)}m`; if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function Row({ c, onReply }: { c: Comment; onReply: (c: Comment) => void }) {
  const name = c.author_name || "Traveler";
  return (
    <div className="flex gap-2.5">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#fce2dc] text-xs font-bold text-[#ef6d5b]">{name.slice(0, 1).toUpperCase()}</div>
      <div className="min-w-0">
        <div className="inline-block rounded-2xl bg-[#faf3ec] px-3 py-2">
          <p className="text-sm"><span className="font-semibold text-[#312b27]">{name}</span> <span className="text-[#8a7e76]">· {ago(c.created_at)}</span></p>
          <p className="text-sm text-[#4a423b]">{c.body}</p>
        </div>
        <button onClick={() => onReply(c)} className="ml-2 mt-1 inline-flex items-center gap-1 text-xs font-medium text-[#8a7e76] hover:text-[#ef6d5b]"><CornerDownRight size={12} /> Reply</button>
      </div>
    </div>
  );
}

/** FB-style comments — flattened to ONE reply level (replying to a reply attaches to the thread root with an @mention),
 *  so it can never infinitely nest. */
export function CommentThread({ postId }: { postId: string }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState("");
  const [reply, setReply] = useState<{ rootId: string; name: string } | null>(null);
  const [replyBody, setReplyBody] = useState("");

  useEffect(() => { getComments(postId).then(setComments); }, [postId]);

  const byId = useMemo(() => new Map(comments.map((c) => [c.id, c])), [comments]);
  // resolve the top-level ancestor of any comment (cycle-guarded — never loops)
  function rootOf(c: Comment): string {
    let cur = c; const seen = new Set<string>();
    while (cur.parent_id && byId.has(cur.parent_id) && !seen.has(cur.id)) { seen.add(cur.id); cur = byId.get(cur.parent_id)!; }
    return cur.id;
  }
  const top = comments.filter((c) => !c.parent_id || !byId.has(c.parent_id));
  const repliesOf = (rootId: string) => comments.filter((c) => c.id !== rootId && rootOf(c) === rootId);

  async function submit(parentId: string | null, text: string, clear: () => void) {
    if (!text.trim()) return;
    const c = await addComment(postId, text.trim(), parentId);
    if (c) { setComments((x) => [...x, c]); clear(); }
  }
  function startReply(c: Comment) { setReply({ rootId: rootOf(c), name: c.author_name || "Traveler" }); setReplyBody(`@${c.author_name || "Traveler"} `); }

  const inputCls = "flex-1 rounded-full border border-[#f0e6dc] bg-white px-4 py-2 text-sm text-[#312b27] outline-none focus:border-[#ef6d5b]";

  return (
    <div className="rounded-2xl border border-[#f0e6dc] bg-white p-4">
      <h3 className="mb-3 font-semibold text-[#312b27]">Comments ({comments.length})</h3>
      <div className="mb-4 flex gap-2">
        <input className={inputCls} value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit(null, body, () => setBody(""))} placeholder="Add a comment…" />
        <button onClick={() => submit(null, body, () => setBody(""))} className="grid h-9 w-9 place-items-center rounded-full bg-[#ef6d5b] text-white"><Send size={15} /></button>
      </div>
      <div className="space-y-4">
        {top.map((c) => (
          <div key={c.id} className="space-y-2">
            <Row c={c} onReply={startReply} />
            {repliesOf(c.id).map((r) => <div key={r.id} className="ml-8"><Row c={r} onReply={startReply} /></div>)}
            {reply?.rootId === c.id && (
              <div className="ml-8 flex gap-2">
                <input className={inputCls} value={replyBody} onChange={(e) => setReplyBody(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit(c.id, replyBody, () => { setReplyBody(""); setReply(null); })} placeholder={`Reply to ${reply.name}…`} autoFocus />
                <button onClick={() => submit(c.id, replyBody, () => { setReplyBody(""); setReply(null); })} className="grid h-9 w-9 place-items-center rounded-full bg-[#ef6d5b] text-white"><Send size={15} /></button>
              </div>
            )}
          </div>
        ))}
        {comments.length === 0 && <p className="text-sm text-[#8a7e76]">Be the first to comment.</p>}
      </div>
    </div>
  );
}
