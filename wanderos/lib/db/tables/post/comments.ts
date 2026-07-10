import { queryAurora } from "../../pool";
import { refreshPostEngagementCounts } from "../travel-posts";

/**
 * post_comments.repo - normalized comments and replies.
 */
export type PostCommentStatus = "visible" | "hidden" | "deleted";

export type PostCommentRow = {
  id: string;
  post_id: string;
  user_id: string;
  author_name?: string | null;
  parent_id: string | null;
  body: string;
  status: PostCommentStatus;
  created_at: string;
  updated_at: string;
};

export async function addPostComment(input: {
  postId: string;
  userId: string;
  body: string;
  parentId?: string | null;
}): Promise<PostCommentRow> {
  const rows = await queryAurora<PostCommentRow>(
    `insert into post_comments (post_id, user_id, parent_id, body)
     values ($1,$2,$3,$4)
     returning *`,
    [input.postId, input.userId, input.parentId ?? null, input.body.trim()]
  );
  await refreshPostEngagementCounts(input.postId);
  return {
    ...rows[0],
    author_name: null
  };
}

export async function listPostComments(postId: string): Promise<PostCommentRow[]> {
  return queryAurora<PostCommentRow>(
    `select c.*, u.name as author_name
       from post_comments c
       join users u on u.id = c.user_id
      where c.post_id = $1
        and c.status = 'visible'
      order by c.created_at asc`,
    [postId]
  );
}

export async function setPostCommentStatus(
  commentId: string,
  postId: string,
  status: PostCommentStatus
): Promise<PostCommentRow | null> {
  const rows = await queryAurora<PostCommentRow>(
    `update post_comments
        set status = $3,
            updated_at = now()
      where id = $1
        and post_id = $2
      returning *`,
    [commentId, postId, status]
  );
  await refreshPostEngagementCounts(postId);
  return rows[0] ?? null;
}
