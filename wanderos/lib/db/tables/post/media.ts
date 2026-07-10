import { queryAurora } from "../../pool";

/**
 * post_media.repo - normalized media rows for travel posts.
 */
export type PostMediaKind = "photo" | "video" | "reel";

export type PostMediaRow = {
  id: string;
  post_id: string;
  media_url: string;
  media_kind: PostMediaKind;
  sort_order: number;
  cloudinary_public_id: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: string | null;
  ai_description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export async function addPostMedia(input: {
  postId: string;
  mediaUrl: string;
  mediaKind?: PostMediaKind;
  sortOrder?: number;
  cloudinaryPublicId?: string | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  aiDescription?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<PostMediaRow> {
  const rows = await queryAurora<PostMediaRow>(
    `insert into post_media
       (post_id, media_url, media_kind, sort_order, cloudinary_public_id, width, height,
        duration_seconds, ai_description, metadata)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     on conflict (post_id, sort_order) do update set
       media_url = excluded.media_url,
       media_kind = excluded.media_kind,
       cloudinary_public_id = excluded.cloudinary_public_id,
       width = excluded.width,
       height = excluded.height,
       duration_seconds = excluded.duration_seconds,
       ai_description = excluded.ai_description,
       metadata = excluded.metadata
     returning *`,
    [
      input.postId,
      input.mediaUrl.trim(),
      input.mediaKind ?? "photo",
      input.sortOrder ?? 0,
      input.cloudinaryPublicId ?? null,
      input.width ?? null,
      input.height ?? null,
      input.durationSeconds ?? null,
      input.aiDescription?.trim() || null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
  return rows[0];
}

export async function listPostMedia(postId: string): Promise<PostMediaRow[]> {
  return queryAurora<PostMediaRow>(
    `select *
       from post_media
      where post_id = $1
      order by sort_order asc, created_at asc`,
    [postId]
  );
}

export async function deletePostMedia(postId: string, mediaId: string): Promise<void> {
  await queryAurora(`delete from post_media where id = $1 and post_id = $2`, [mediaId, postId]);
}
