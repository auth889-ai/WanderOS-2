import { queryAurora } from "../../pool";
import { refreshPostEngagementCounts } from "../travel-posts";

/**
 * post_reactions.repo - one reaction per user per post.
 */
export type PostReactionKind = "like" | "love" | "fire" | "wow";

export type PostReactionRow = {
  id: string;
  post_id: string;
  user_id: string;
  kind: PostReactionKind;
  created_at: string;
};

export async function setPostReaction(postId: string, userId: string, kind: PostReactionKind): Promise<PostReactionRow> {
  const rows = await queryAurora<PostReactionRow>(
    `insert into post_reactions (post_id, user_id, kind)
     values ($1,$2,$3)
     on conflict (post_id, user_id) do update set kind = excluded.kind, created_at = now()
     returning *`,
    [postId, userId, kind]
  );
  await refreshPostEngagementCounts(postId);
  return rows[0];
}

export async function removePostReaction(postId: string, userId: string): Promise<void> {
  await queryAurora(`delete from post_reactions where post_id = $1 and user_id = $2`, [postId, userId]);
  await refreshPostEngagementCounts(postId);
}

export async function listPostReactions(postId: string): Promise<PostReactionRow[]> {
  return queryAurora<PostReactionRow>(
    `select *
       from post_reactions
      where post_id = $1
      order by created_at desc`,
    [postId]
  );
}
