/**
 * S2 DB test - social feed foundation.
 *   Run: npm run test:db:social-feed
 */
import { readFileSync } from "fs";
import { randomUUID } from "crypto";

for (const line of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("#") || line.trim().startsWith("//")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { queryAurora } = await import("../../lib/db/pool");
const posts = await import("../../lib/db/tables/travel-posts");
const media = await import("../../lib/db/tables/post/media");
const reactions = await import("../../lib/db/tables/post/reactions");
const saves = await import("../../lib/db/tables/post/saves");
const comments = await import("../../lib/db/tables/post/comments");
const follows = await import("../../lib/db/tables/follows");
const attributions = await import("../../lib/db/tables/post/attributions");
const { createBooking } = await import("../../lib/services/booking.service");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── S2: social feed DB foundation ──\n");

async function createUser(role: "traveler" | "host") {
  const [user] = await queryAurora<{ id: string }>(
    `insert into users (name, email, role) values ($1,$2,$3) returning id`,
    [`Social ${role}`, `social-${role}-${randomUUID()}@test.local`, role]
  );
  return user;
}

const host = await createUser("host");
const author = await createUser("traveler");
const viewer = await createUser("traveler");

const [listing] = await queryAurora<{ id: string }>(
  `insert into listings (host_id,title,description,city,country,category,price,max_guests,status,moderation_status)
   values ($1,'S2 Verified Stay','A real approved stay','Tokyo','Japan','apartment',220,2,'published','approved')
   returning id`,
  [host.id]
);

let bookingId = "";
let postId = "";

try {
  const bookingResult = await createBooking(author.id, {
    listingId: listing.id,
    checkIn: "2026-07-01",
    checkOut: "2026-07-04",
    guests: 2
  });

  if (bookingResult.ok && bookingResult.booking?.status === "confirmed") {
    bookingId = bookingResult.booking.id;
    ok("confirmed booking exists for future verified-stay checks");
  } else {
    no(`booking setup failed: ${bookingResult.error}`);
  }

  const draft = await posts.createPostDraft({
    authorId: author.id,
    listingId: listing.id,
    bookingId,
    title: "Tokyo verified food stay",
    caption: "A real stay-backed Tokyo memory.",
    location: "Shinjuku",
    destination: "Tokyo",
    mood: "city glow",
    tags: ["tokyo", "food", "verified"],
    postType: "carousel"
  });
  postId = draft.id;

  draft.status === "draft" && draft.verified_stay === false
    ? ok("createPostDraft creates owner draft without fake verified badge")
    : no(`draft status=${draft.status} verified=${draft.verified_stay}`);

  (await posts.listRecentTravelPosts()).some((p) => p.id === postId)
    ? no("draft leaked into public feed")
    : ok("draft is excluded from public feed");

  await media.addPostMedia({
    postId,
    mediaUrl: "https://res.cloudinary.com/demo/image/upload/social-2.jpg",
    sortOrder: 1,
    aiDescription: "Dinner street in Tokyo"
  });
  await media.addPostMedia({
    postId,
    mediaUrl: "https://res.cloudinary.com/demo/image/upload/social-1.jpg",
    sortOrder: 0,
    aiDescription: "Hotel window near Shinjuku"
  });
  const mediaRows = await media.listPostMedia(postId);
  mediaRows.length === 2 && mediaRows[0].sort_order === 0 && mediaRows[1].sort_order === 1
    ? ok("post_media stores carousel rows in stable order")
    : no(`media ordering wrong: ${mediaRows.map((m) => m.sort_order).join(",")}`);

  await reactions.setPostReaction(postId, viewer.id, "love");
  await reactions.setPostReaction(postId, viewer.id, "fire");
  const reactionRows = await reactions.listPostReactions(postId);
  reactionRows.length === 1 && reactionRows[0].kind === "fire"
    ? ok("post_reactions enforces one reaction per user and updates kind")
    : no(`reaction rows=${reactionRows.length} kind=${reactionRows[0]?.kind}`);

  await saves.savePost(postId, viewer.id, "Tokyo ideas");
  await saves.savePost(postId, viewer.id, "Tokyo ideas");
  const saved = await saves.listSavedPosts(viewer.id);
  saved.filter((s) => s.post_id === postId).length === 1
    ? ok("post_saves dedupes by user and collection")
    : no("save duplicate was created");

  const comment = await comments.addPostComment({ postId, userId: viewer.id, body: "This stay looks useful." });
  await comments.addPostComment({ postId, userId: author.id, parentId: comment.id, body: "It was booked through WanderOS." });
  const commentRows = await comments.listPostComments(postId);
  commentRows.length === 2 ? ok("post_comments stores comments and replies as rows") : no(`comments=${commentRows.length}`);

  const refreshed = await posts.getTravelPostById(postId);
  refreshed?.like_count === 1 && refreshed.save_count === 1 && refreshed.comment_count === 2
    ? ok("travel_posts denormalized engagement counters refresh")
    : no(`counts like=${refreshed?.like_count} save=${refreshed?.save_count} comments=${refreshed?.comment_count}`);

  const follow = await follows.followUser(viewer.id, author.id);
  const selfFollow = await follows.followUser(viewer.id, viewer.id);
  const following = await follows.listFollowing(viewer.id);
  follow?.following_id === author.id && selfFollow === null && following.some((f) => f.following_id === author.id)
    ? ok("follows stores social graph and blocks self-follow")
    : no("follow graph mismatch");

  await attributions.recordPostAttribution({
    postId,
    viewerId: viewer.id,
    listingId: listing.id,
    attributionType: "click"
  });
  const attrRows = await attributions.listPostAttributions(postId);
  attrRows.length === 1 && attrRows[0].attribution_type === "click"
    ? ok("post_booking_attributions stores Stay here click proof")
    : no(`attributions=${attrRows.length}`);

  await posts.updatePostStatus(postId, author.id, "published", "approved");
  const visible = await posts.listRecentTravelPosts();
  visible.some((p) => p.id === postId) ? ok("published public post appears in feed") : no("published post missing from feed");
} finally {
  if (postId) await queryAurora(`delete from travel_posts where id = $1`, [postId]).catch(() => {});
  if (bookingId) await queryAurora(`delete from bookings where id = $1`, [bookingId]).catch(() => {});
  await queryAurora(`delete from listings where id = $1`, [listing.id]).catch(() => {});
  await queryAurora(`delete from users where id = any($1::uuid[])`, [[host.id, author.id, viewer.id]]).catch(() => {});
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
