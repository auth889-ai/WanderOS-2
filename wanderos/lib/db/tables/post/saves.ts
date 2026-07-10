import { queryAurora } from "../../pool";
import { refreshPostEngagementCounts } from "../travel-posts";

/**
 * post_saves.repo - saved posts and lightweight collections.
 */
export type PostSaveRow = {
  id: string;
  post_id: string;
  user_id: string;
  collection_name: string;
  created_at: string;
};

export async function savePost(postId: string, userId: string, collectionName = "default"): Promise<PostSaveRow> {
  const rows = await queryAurora<PostSaveRow>(
    `insert into post_saves (post_id, user_id, collection_name)
     values ($1,$2,$3)
     on conflict (post_id, user_id, collection_name) do update set created_at = post_saves.created_at
     returning *`,
    [postId, userId, collectionName.trim() || "default"]
  );
  await refreshPostEngagementCounts(postId);
  return rows[0];
}

export async function unsavePost(postId: string, userId: string, collectionName = "default"): Promise<void> {
  await queryAurora(
    `delete from post_saves where post_id = $1 and user_id = $2 and collection_name = $3`,
    [postId, userId, collectionName.trim() || "default"]
  );
  await refreshPostEngagementCounts(postId);
}

export async function listSavedPosts(userId: string): Promise<PostSaveRow[]> {
  return queryAurora<PostSaveRow>(
    `select *
       from post_saves
      where user_id = $1
      order by created_at desc`,
    [userId]
  );
}
