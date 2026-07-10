import { queryAurora } from "../pool";

/**
 * follows.repo - normalized traveler/host social graph.
 */
export type FollowRow = {
  follower_id: string;
  following_id: string;
  created_at: string;
};

export async function followUser(followerId: string, followingId: string): Promise<FollowRow | null> {
  if (followerId === followingId) return null;

  const rows = await queryAurora<FollowRow>(
    `insert into follows (follower_id, following_id)
     values ($1,$2)
     on conflict (follower_id, following_id) do update set created_at = follows.created_at
     returning *`,
    [followerId, followingId]
  );
  return rows[0] ?? null;
}

export async function unfollowUser(followerId: string, followingId: string): Promise<void> {
  await queryAurora(
    `delete from follows where follower_id = $1 and following_id = $2`,
    [followerId, followingId]
  );
}

export async function listFollowing(userId: string): Promise<FollowRow[]> {
  return queryAurora<FollowRow>(
    `select *
       from follows
      where follower_id = $1
      order by created_at desc`,
    [userId]
  );
}

export async function listFollowers(userId: string): Promise<FollowRow[]> {
  return queryAurora<FollowRow>(
    `select *
       from follows
      where following_id = $1
      order by created_at desc`,
    [userId]
  );
}
