import { queryAurora } from "../pool";

/**
 * travel_posts.repo — traveler feed rows stored in Aurora.
 */
export type TravelPostStatus = "draft" | "pending_review" | "published" | "rejected" | "deleted";
export type TravelPostType = "text" | "photo" | "carousel" | "reel" | "trip_recap";
export type TravelPostVisibility = "public" | "private";

export type TravelPostRow = {
  id: string;
  author_id: string;
  author_name?: string;
  trip_id: string | null;
  listing_id: string | null;
  booking_id: string | null;
  status: TravelPostStatus;
  post_type: TravelPostType;
  title: string;
  caption: string | null;
  body: string | null;
  location: string | null;
  destination: string | null;
  media_url: string | null;
  mood: string | null;
  tags: string[];
  visibility: TravelPostVisibility;
  verified_stay: boolean;
  ai_summary: string | null;
  moderation_status: string;
  moderation_report: Record<string, unknown>;
  compose_job_id: string | null;
  like_count: number;
  save_count: number;
  comment_count: number;
  view_count: number;
  created_at: string;
  updated_at: string;
  semantic_score?: number;
  ranking_score?: number;
};

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

export async function listRecentTravelPosts(limit = 12): Promise<TravelPostRow[]> {
  return queryAurora<TravelPostRow>(
    `select p.*, u.name as author_name
     from travel_posts p
     join users u on u.id = p.author_id
     where p.status = 'published'
       and p.visibility = 'public'
     order by p.created_at desc
     limit $1`,
    [limit]
  );
}

export async function listPublicTravelPosts(limit = 20): Promise<TravelPostRow[]> {
  return queryAurora<TravelPostRow>(
    `select p.*, u.name as author_name
       from travel_posts p
       join users u on u.id = p.author_id
      where p.status = 'published'
        and p.visibility = 'public'
      order by
        (p.like_count + p.save_count * 2 + p.comment_count * 3 + case when p.verified_stay then 8 else 0 end) desc,
        p.created_at desc
      limit $1`,
    [limit]
  );
}

export async function listVerifiedTravelPosts(limit = 20): Promise<TravelPostRow[]> {
  return queryAurora<TravelPostRow>(
    `select p.*, u.name as author_name
       from travel_posts p
       join users u on u.id = p.author_id
      where p.status = 'published'
        and p.visibility = 'public'
        and p.verified_stay = true
      order by p.created_at desc
      limit $1`,
    [limit]
  );
}

export async function listVectorRankedTravelPosts(params: {
  embedding: number[];
  limit?: number;
}): Promise<TravelPostRow[]> {
  return queryAurora<TravelPostRow>(
    `select p.*, u.name as author_name,
            greatest(0, 1 - (e.embedding <=> $1::vector)) as semantic_score,
            (
              greatest(0, 1 - (e.embedding <=> $1::vector)) * 0.62
              + least(0.14, (p.like_count * 0.02 + p.save_count * 0.03 + p.comment_count * 0.04))
              + case when p.verified_stay then 0.12 else 0 end
              + greatest(0, 0.12 - least(0.12, extract(epoch from (now() - p.created_at)) / 604800 * 0.03))
            ) as ranking_score
       from travel_posts p
       join users u on u.id = p.author_id
       join embeddings e on e.owner_type = 'post' and e.owner_id = p.id
      where p.status = 'published'
        and p.visibility = 'public'
      order by ranking_score desc, p.created_at desc
      limit $2`,
    [toVectorLiteral(params.embedding), Math.max(1, Math.min(params.limit ?? 20, 50))]
  );
}

export async function listFollowingTravelPosts(viewerId: string, limit = 20): Promise<TravelPostRow[]> {
  return queryAurora<TravelPostRow>(
    `select p.*, u.name as author_name
       from travel_posts p
       join users u on u.id = p.author_id
       join follows f on f.following_id = p.author_id
      where f.follower_id = $1
        and p.status = 'published'
        and p.visibility = 'public'
      order by p.created_at desc
      limit $2`,
    [viewerId, limit]
  );
}

export async function listDestinationTravelPosts(destination: string, limit = 20): Promise<TravelPostRow[]> {
  const needle = `%${destination.trim()}%`;
  return queryAurora<TravelPostRow>(
    `select p.*, u.name as author_name
       from travel_posts p
       join users u on u.id = p.author_id
      where p.status = 'published'
        and p.visibility = 'public'
        and (
          lower(p.destination) = lower($1)
          or lower(p.location) like lower($2)
          or lower($1) = any(select lower(unnest(p.tags)))
        )
      order by p.created_at desc
      limit $3`,
    [destination.trim(), needle, limit]
  );
}

export async function listSavedTravelPostSignals(userId: string, limit = 12): Promise<TravelPostRow[]> {
  return queryAurora<TravelPostRow>(
    `select distinct p.*, u.name as author_name
       from post_saves s
       join travel_posts p on p.id = s.post_id
       join users u on u.id = p.author_id
      where s.user_id = $1
        and p.status = 'published'
        and p.visibility = 'public'
      order by p.created_at desc
      limit $2`,
    [userId, Math.max(1, Math.min(limit, 30))]
  );
}

export async function getTravelPostById(id: string): Promise<TravelPostRow | null> {
  const rows = await queryAurora<TravelPostRow>(
    `select p.*, u.name as author_name
       from travel_posts p
       join users u on u.id = p.author_id
      where p.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function getTravelPostForAuthor(id: string, authorId: string): Promise<TravelPostRow | null> {
  const rows = await queryAurora<TravelPostRow>(
    `select * from travel_posts where id = $1 and author_id = $2 and status <> 'deleted'`,
    [id, authorId]
  );
  return rows[0] ?? null;
}

export async function listTravelPostsForAuthor(authorId: string): Promise<TravelPostRow[]> {
  return queryAurora<TravelPostRow>(
    `select *
       from travel_posts
      where author_id = $1
        and status <> 'deleted'
      order by created_at desc`,
    [authorId]
  );
}

export async function createTravelPost(input: {
  authorId: string;
  tripId?: string;
  title: string;
  caption?: string;
  location?: string;
  mediaUrl?: string;
  mood?: string;
}): Promise<TravelPostRow> {
  const rows = await queryAurora<TravelPostRow>(
    `insert into travel_posts
       (author_id, trip_id, title, caption, location, media_url, mood, status, visibility, post_type, moderation_status)
     values ($1, nullif($2, '')::uuid, $3, $4, $5, $6, $7, 'published', 'public', 'text', 'not_reviewed')
     returning *`,
    [
      input.authorId,
      input.tripId || "",
      input.title.trim(),
      input.caption?.trim() || null,
      input.location?.trim() || null,
      input.mediaUrl?.trim() || null,
      input.mood?.trim() || null
    ]
  );
  return rows[0];
}

export async function createPostDraft(input: {
  authorId: string;
  tripId?: string | null;
  listingId?: string | null;
  bookingId?: string | null;
  title: string;
  caption?: string | null;
  body?: string | null;
  location?: string | null;
  destination?: string | null;
  mediaUrl?: string | null;
  mood?: string | null;
  tags?: string[];
  postType?: TravelPostType;
  visibility?: TravelPostVisibility;
  aiSummary?: string | null;
  moderationReport?: Record<string, unknown>;
}): Promise<TravelPostRow> {
  const rows = await queryAurora<TravelPostRow>(
    `insert into travel_posts
       (author_id, trip_id, listing_id, booking_id, title, caption, body, location, destination,
        media_url, mood, tags, post_type, visibility, status, moderation_status, moderation_report, ai_summary)
     values
       ($1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, 'draft', 'not_reviewed', $15::jsonb, $16)
     returning *`,
    [
      input.authorId,
      input.tripId || null,
      input.listingId || null,
      input.bookingId || null,
      input.title.trim(),
      input.caption?.trim() || null,
      input.body?.trim() || null,
      input.location?.trim() || null,
      input.destination?.trim() || null,
      input.mediaUrl?.trim() || null,
      input.mood?.trim() || null,
      input.tags ?? [],
      input.postType ?? "text",
      input.visibility ?? "public",
      JSON.stringify(input.moderationReport ?? {}),
      input.aiSummary?.trim() || null
    ]
  );
  return rows[0];
}

export async function updatePostStatus(
  postId: string,
  authorId: string,
  status: TravelPostStatus,
  moderationStatus?: string
): Promise<TravelPostRow | null> {
  const rows = await queryAurora<TravelPostRow>(
    `update travel_posts
        set status = $3,
            moderation_status = coalesce($4, moderation_status),
            updated_at = now()
      where id = $1
        and author_id = $2
        and status <> 'deleted'
      returning *`,
    [postId, authorId, status, moderationStatus ?? null]
  );
  return rows[0] ?? null;
}

export async function updatePostContent(
  postId: string,
  authorId: string,
  patch: {
    title?: string;
    caption?: string | null;
    body?: string | null;
    location?: string | null;
    destination?: string | null;
    mood?: string | null;
    tags?: string[];
    visibility?: TravelPostVisibility;
  }
): Promise<TravelPostRow | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  const allowed: Record<string, string> = {
    title: "title",
    caption: "caption",
    body: "body",
    location: "location",
    destination: "destination",
    mood: "mood",
    tags: "tags",
    visibility: "visibility"
  };

  for (const [key, column] of Object.entries(allowed)) {
    if (patch[key as keyof typeof patch] !== undefined) {
      values.push(patch[key as keyof typeof patch]);
      fields.push(`${column} = $${values.length}`);
    }
  }

  if (!fields.length) return getTravelPostForAuthor(postId, authorId);

  values.push(postId, authorId);
  const rows = await queryAurora<TravelPostRow>(
    `update travel_posts
        set ${fields.join(", ")},
            updated_at = now()
      where id = $${values.length - 1}
        and author_id = $${values.length}
        and status in ('draft', 'pending_review', 'published', 'rejected')
      returning *`,
    values
  );
  return rows[0] ?? null;
}

export async function softDeletePost(postId: string, authorId: string): Promise<TravelPostRow | null> {
  const rows = await queryAurora<TravelPostRow>(
    `update travel_posts
        set status = 'deleted',
            updated_at = now()
      where id = $1
        and author_id = $2
        and status <> 'deleted'
      returning *`,
    [postId, authorId]
  );
  return rows[0] ?? null;
}

export async function setPostComposeJob(postId: string, authorId: string, jobId: string): Promise<TravelPostRow | null> {
  const rows = await queryAurora<TravelPostRow>(
    `update travel_posts
        set compose_job_id = $3,
            updated_at = now()
      where id = $1
        and author_id = $2
      returning *`,
    [postId, authorId, jobId]
  );
  return rows[0] ?? null;
}

export async function applyPostModeration(
  postId: string,
  input: {
    moderationStatus: string;
    moderationReport?: Record<string, unknown>;
    status?: TravelPostStatus;
  }
): Promise<TravelPostRow | null> {
  const rows = await queryAurora<TravelPostRow>(
    `update travel_posts
        set moderation_status = $2,
            moderation_report = $3::jsonb,
            status = coalesce($4, status),
            updated_at = now()
      where id = $1
      returning *`,
    [postId, input.moderationStatus, JSON.stringify(input.moderationReport ?? {}), input.status ?? null]
  );
  return rows[0] ?? null;
}

export async function applyPostComposeResult(
  postId: string,
  authorId: string,
  input: {
    caption: string;
    body?: string | null;
    mood?: string | null;
    tags?: string[];
    destination?: string | null;
    aiSummary?: string | null;
    moderationStatus: string;
    moderationReport?: Record<string, unknown>;
    status?: TravelPostStatus;
  }
): Promise<TravelPostRow | null> {
  const rows = await queryAurora<TravelPostRow>(
    `update travel_posts
        set caption = $3,
            body = coalesce($4, body),
            mood = coalesce($5, mood),
            tags = $6,
            destination = coalesce($7, destination),
            ai_summary = coalesce($8, ai_summary),
            moderation_status = $9,
            moderation_report = $10::jsonb,
            status = coalesce($11, status),
            updated_at = now()
      where id = $1
        and author_id = $2
        and status in ('draft', 'pending_review', 'published', 'rejected')
      returning *`,
    [
      postId,
      authorId,
      input.caption.trim(),
      input.body?.trim() || null,
      input.mood?.trim() || null,
      input.tags ?? [],
      input.destination?.trim() || null,
      input.aiSummary?.trim() || null,
      input.moderationStatus,
      JSON.stringify(input.moderationReport ?? {}),
      input.status ?? null
    ]
  );
  return rows[0] ?? null;
}

export async function setVerifiedStay(postId: string, verified: boolean): Promise<TravelPostRow | null> {
  const rows = await queryAurora<TravelPostRow>(
    `update travel_posts
        set verified_stay = $2,
            updated_at = now()
      where id = $1
      returning *`,
    [postId, verified]
  );
  return rows[0] ?? null;
}

export async function incrementPostView(postId: string): Promise<void> {
  await queryAurora(
    `update travel_posts
        set view_count = view_count + 1,
            updated_at = now()
      where id = $1
        and status = 'published'
        and visibility = 'public'`,
    [postId]
  );
}

export async function refreshPostEngagementCounts(postId: string): Promise<void> {
  await queryAurora(
    `update travel_posts
        set like_count = (select count(*)::int from post_reactions where post_id = $1),
            save_count = (select count(*)::int from post_saves where post_id = $1),
            comment_count = (select count(*)::int from post_comments where post_id = $1 and status = 'visible'),
            updated_at = now()
      where id = $1`,
    [postId]
  );
}
