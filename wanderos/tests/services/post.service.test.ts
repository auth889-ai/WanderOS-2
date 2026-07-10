/**
 * S3 service test - post.service + feed.service + post-trust.service.
 *   Run: npm run test:svc:post
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
const postService = await import("../../lib/services/post.service");
const feedService = await import("../../lib/services/feed.service");
const trustService = await import("../../lib/services/post-trust.service");
const { createBooking } = await import("../../lib/services/booking.service");
const follows = await import("../../lib/db/tables/follows");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── S3: post/feed services ──\n");

async function createUser(role: "traveler" | "host", label: string) {
  const [user] = await queryAurora<{ id: string }>(
    `insert into users (name, email, role) values ($1,$2,$3) returning id`,
    [`S3 ${label}`, `s3-${label}-${randomUUID()}@test.local`, role]
  );
  return user;
}

const host = await createUser("host", "host");
const author = await createUser("traveler", "author");
const viewer = await createUser("traveler", "viewer");
const other = await createUser("traveler", "other");

const [listing] = await queryAurora<{ id: string }>(
  `insert into listings (host_id,title,description,city,country,category,price,max_guests,status,moderation_status)
   values ($1,'S3 Feed Stay','A public stay for social proof','Tokyo','Japan','apartment',180,2,'published','approved')
   returning id`,
  [host.id]
);

let bookingId = "";
let verifiedPostId = "";
let privatePostId = "";
let blockedPostId = "";

try {
  const booking = await createBooking(author.id, {
    listingId: listing.id,
    checkIn: "2026-08-01",
    checkOut: "2026-08-04",
    guests: 2
  });
  if (booking.ok && booking.booking) {
    bookingId = booking.booking.id;
    ok("confirmed booking setup works");
  } else {
    no(`booking setup failed: ${booking.error}`);
  }

  const trust = await trustService.verifyStayForPost({
    authorId: author.id,
    listingId: listing.id,
    bookingId
  });
  trust.verified ? ok("post-trust verifies author-owned confirmed booking") : no(`trust failed: ${trust.reason}`);

  const otherTrust = await trustService.verifyStayForPost({
    authorId: other.id,
    listingId: listing.id,
    bookingId
  });
  !otherTrust.verified && otherTrust.reason === "booking_not_owned_by_author"
    ? ok("post-trust rejects another user's booking")
    : no(`wrong trust result: ${otherTrust.reason}`);

  const draft = await postService.createDraftPost(author.id, {
    listingId: listing.id,
    bookingId,
    title: "Verified Tokyo stay",
    caption: "This came from a real booking.",
    destination: "Tokyo",
    location: "Shinjuku",
    tags: ["Tokyo", "Food", "Verified"],
    media: [
      { mediaUrl: "https://res.cloudinary.com/demo/image/upload/s3-a.jpg", sortOrder: 0 },
      { mediaUrl: "https://res.cloudinary.com/demo/image/upload/s3-b.jpg", sortOrder: 1 }
    ]
  });
  verifiedPostId = draft.post.id;

  draft.post.status === "draft" && draft.media.length === 2
    ? ok("createDraftPost creates draft with normalized media")
    : no(`draft status=${draft.post.status} media=${draft.media.length}`);

  (await postService.getOwnPost(author.id, verifiedPostId))?.post.id === verifiedPostId
    ? ok("author can read own draft")
    : no("author could not read own draft");
  (await postService.getOwnPost(other.id, verifiedPostId)) === null
    ? ok("other user cannot read draft by owner-scoped service")
    : no("privacy breach: other user read draft");

  (await feedService.getFeed({ viewerId: viewer.id })).some((p) => p.id === verifiedPostId)
    ? no("draft leaked into public feed")
    : ok("feed excludes drafts");

  const published = await postService.publishPost(author.id, verifiedPostId);
  published?.status === "published" && published.verified_stay === true
    ? ok("publishPost sets published and real verified stay")
    : no(`published status=${published?.status} verified=${published?.verified_stay}`);

  const feed = await feedService.getFeed({ viewerId: viewer.id, tab: "for-you" });
  feed.some((p) => p.id === verifiedPostId) ? ok("published post appears in For You feed") : no("published post missing");

  const verifiedFeed = await feedService.getFeed({ viewerId: viewer.id, tab: "verified" });
  verifiedFeed.some((p) => p.id === verifiedPostId) ? ok("Verified tab includes booking-backed post") : no("verified feed missing post");

  await follows.followUser(viewer.id, author.id);
  const followingFeed = await feedService.getFeed({ viewerId: viewer.id, tab: "following" });
  followingFeed.some((p) => p.id === verifiedPostId) ? ok("Following feed includes followed author post") : no("following feed missing post");

  const destinationFeed = await feedService.getFeed({ viewerId: viewer.id, tab: "destination", destination: "Tokyo" });
  destinationFeed.some((p) => p.id === verifiedPostId) ? ok("Destination feed filters by destination") : no("destination feed missing post");

  await postService.reactToPost(viewer.id, verifiedPostId, "love");
  await postService.saveVisiblePost(viewer.id, verifiedPostId, "Tokyo");
  await postService.commentOnPost(viewer.id, verifiedPostId, "Useful social proof.");
  const afterEngagement = await postService.getOwnPost(author.id, verifiedPostId);
  afterEngagement?.post.like_count === 1 && afterEngagement.post.save_count === 1 && afterEngagement.post.comment_count === 1
    ? ok("engagement services update counters on visible posts")
    : no(`counts l=${afterEngagement?.post.like_count} s=${afterEngagement?.post.save_count} c=${afterEngagement?.post.comment_count}`);

  const editedByOther = await postService.editOwnPost(other.id, verifiedPostId, { title: "stolen" });
  editedByOther === null ? ok("editOwnPost blocks non-owner") : no("privacy breach: non-owner edited");

  const privateDraft = await postService.createDraftPost(author.id, {
    title: "Private Tokyo note",
    caption: "Not public.",
    destination: "Tokyo",
    visibility: "private"
  });
  privatePostId = privateDraft.post.id;
  await postService.publishPost(author.id, privatePostId);
  (await feedService.getFeed({ viewerId: viewer.id })).some((p) => p.id === privatePostId)
    ? no("private published post leaked")
    : ok("public feed excludes private posts");

  const blockedDraft = await postService.createDraftPost(author.id, {
    title: "Blocked post",
    caption: "Should not publish"
  });
  blockedPostId = blockedDraft.post.id;
  await postService.applyModerationResult(blockedPostId, {
    moderationStatus: "blocked",
    moderationReport: { reason: "policy" }
  });
  let blocked = false;
  try {
    await postService.publishPost(author.id, blockedPostId);
  } catch {
    blocked = true;
  }
  blocked ? ok("moderation-blocked post cannot publish") : no("blocked post published");

  const deleted = await postService.deleteOwnPost(author.id, verifiedPostId);
  deleted?.status === "deleted" ? ok("deleteOwnPost soft-deletes owner post") : no(`delete status=${deleted?.status}`);
  (await feedService.getFeed({ viewerId: viewer.id })).some((p) => p.id === verifiedPostId)
    ? no("deleted post still visible")
    : ok("feed excludes deleted post");
} finally {
  await queryAurora(`delete from travel_posts where id = any($1::uuid[])`, [[verifiedPostId, privatePostId, blockedPostId].filter(Boolean)]).catch(() => {});
  if (bookingId) await queryAurora(`delete from bookings where id = $1`, [bookingId]).catch(() => {});
  await queryAurora(`delete from listings where id = $1`, [listing.id]).catch(() => {});
  await queryAurora(`delete from users where id = any($1::uuid[])`, [[host.id, author.id, viewer.id, other.id]]).catch(() => {});
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
