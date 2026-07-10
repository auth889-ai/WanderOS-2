/** Shared feed/post types — single source of truth for the feed UI. */
export type FeedPost = {
  id: string;
  author_id?: string;
  author_name?: string;
  visibility?: string;
  caption: string | null;
  title: string;
  location: string | null;
  media_url: string | null;
  post_type?: string;
  tags: string[];
  verified_stay: boolean;
  listing_id: string | null;
  like_count: number;
  save_count: number;
  comment_count: number;
  created_at: string;
};

export type PostMedia = {
  id: string;
  media_url: string;
  media_kind: string;
  ai_description?: string | null;
  sort_order?: number;
};
