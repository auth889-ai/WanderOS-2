/**
 * E2E (HTTP) - social feed API over real HTTP.
 *   Run: npm run test:e2e:social-feed
 *
 * Proves the route layer for the Social Commerce Feed:
 * auth/RBAC, draft privacy, publish, verified-stay, feed tabs, engagement, follow, and Stay here attribution.
 */
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { spawn, ChildProcess } from "child_process";

for (const line of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("#") || line.trim().startsWith("//")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { queryAurora } = await import("../../lib/db/pool");
const { createSessionToken, sessionCookieName } = await import("../../lib/auth/token");
const { createBooking } = await import("../../lib/services/booking.service");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

const BASE = "http://localhost:5050";
console.log("\n── E2E (HTTP): social feed API ──\n");

async function createUser(role: "traveler" | "host" | "admin", label: string) {
  const [user] = await queryAurora<{ id: string; email: string }>(
    `insert into users (name, email, role) values ($1,$2,$3) returning id, email`,
    [`Feed HTTP ${label}`, `feed-http-${label}-${randomUUID()}@test.local`, role]
  );
  return user;
}

const host = await createUser("host", "host");
const author = await createUser("traveler", "author");
const viewer = await createUser("traveler", "viewer");
const other = await createUser("traveler", "other");

const authorCookie = `${sessionCookieName}=${createSessionToken({
  id: author.id,
  name: "Feed HTTP Author",
  email: author.email,
  role: "traveler"
})}`;
const viewerCookie = `${sessionCookieName}=${createSessionToken({
  id: viewer.id,
  name: "Feed HTTP Viewer",
  email: viewer.email,
  role: "traveler"
})}`;
const otherCookie = `${sessionCookieName}=${createSessionToken({
  id: other.id,
  name: "Feed HTTP Other",
  email: other.email,
  role: "traveler"
})}`;
const hostCookie = `${sessionCookieName}=${createSessionToken({
  id: host.id,
  name: "Feed HTTP Host",
  email: host.email,
  role: "host"
})}`;

const H = (cookie?: string) => ({ "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) });

let server: ChildProcess | null = null;
let listingId = "";
let bookingId = "";
let postId = "";
let privatePostId = "";

async function waitForServer(timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/auth/me`, { headers: H() });
      if (r.status > 0) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

try {
  const [listing] = await queryAurora<{ id: string }>(
    `insert into listings (host_id,title,description,city,country,category,price,max_guests,status,moderation_status)
     values ($1,'Feed HTTP Verified Stay','A booking-backed social proof stay.','Tokyo','Japan','apartment',210,2,'published','approved')
     returning id`,
    [host.id]
  );
  listingId = listing.id;

  const booking = await createBooking(author.id, {
    listingId,
    checkIn: "2026-09-01",
    checkOut: "2026-09-04",
    guests: 2
  });
  if (booking.ok && booking.booking) {
    bookingId = booking.booking.id;
    ok("setup confirmed booking");
  } else {
    no(`booking setup failed: ${booking.error}`);
  }

  console.log("booting next dev (port 5050)...");
  server = spawn("npm run dev", { cwd: new URL("../../", import.meta.url).pathname, shell: true, detached: true, stdio: "ignore" });
  const up = await waitForServer();
  up ? ok("dev server is up") : no("dev server did not start in time");
  if (!up) throw new Error("server boot failed");

  const unauthFeed = await fetch(`${BASE}/api/feed`);
  unauthFeed.status === 401 ? ok("GET /api/feed without session -> 401") : no(`unauth feed status=${unauthFeed.status}`);

  const hostFeed = await fetch(`${BASE}/api/feed`, { headers: H(hostCookie) });
  hostFeed.status === 403 ? ok("GET /api/feed as host -> 403") : no(`host feed status=${hostFeed.status}`);

  const hostCreate = await fetch(`${BASE}/api/posts`, {
    method: "POST",
    headers: H(hostCookie),
    body: JSON.stringify({ title: "Host should not post as traveler" })
  });
  hostCreate.status === 403 ? ok("POST /api/posts as host -> 403") : no(`host post status=${hostCreate.status}`);

  const badCreate = await fetch(`${BASE}/api/posts`, {
    method: "POST",
    headers: H(authorCookie),
    body: JSON.stringify({ title: "" })
  });
  badCreate.status === 400 ? ok("POST /api/posts invalid body -> 400") : no(`bad create status=${badCreate.status}`);

  const create = await fetch(`${BASE}/api/posts`, {
    method: "POST",
    headers: H(authorCookie),
    body: JSON.stringify({
      listingId,
      bookingId,
      title: "Tokyo stay that drove booking trust",
      caption: "A verified stay-backed food and culture memory.",
      destination: "Tokyo",
      location: "Shinjuku",
      mood: "city glow",
      tags: ["Tokyo", "Food", "Verified"],
      media: [
        { mediaUrl: "https://res.cloudinary.com/demo/image/upload/feed-http-1.jpg", sortOrder: 0 },
        { mediaUrl: "https://res.cloudinary.com/demo/image/upload/feed-http-2.jpg", sortOrder: 1 }
      ]
    })
  });
  const created = await create.json();
  postId = created.post?.id;
  create.status === 201 && postId && created.post?.status === "draft" && created.media?.length === 2
    ? ok("POST /api/posts creates owner draft with media")
    : no(`create status=${create.status} body=${JSON.stringify(created)}`);

  const ownDraft = await fetch(`${BASE}/api/posts/${postId}`, { headers: H(authorCookie) });
  ownDraft.status === 200 ? ok("GET own draft -> 200") : no(`own draft status=${ownDraft.status}`);

  const otherDraft = await fetch(`${BASE}/api/posts/${postId}`, { headers: H(otherCookie) });
  otherDraft.status === 404 ? ok("GET draft as another traveler -> 404") : no(`other draft status=${otherDraft.status}`);

  const feedBeforePublish = await (await fetch(`${BASE}/api/feed`, { headers: H(viewerCookie) })).json();
  feedBeforePublish.posts?.some((p: { id: string }) => p.id === postId)
    ? no("draft leaked into feed")
    : ok("feed excludes draft before publish");

  const otherPublish = await fetch(`${BASE}/api/posts/${postId}/publish`, {
    method: "POST",
    headers: H(otherCookie)
  });
  otherPublish.status === 404 ? ok("publish as another traveler -> 404") : no(`other publish status=${otherPublish.status}`);

  const publish = await fetch(`${BASE}/api/posts/${postId}/publish`, {
    method: "POST",
    headers: H(authorCookie)
  });
  const published = await publish.json();
  publish.status === 200 && published.post?.status === "published" && published.post?.verified_stay === true
    ? ok("publish owner post -> 200 + verified stay")
    : no(`publish status=${publish.status} body=${JSON.stringify(published)}`);

  const publicPost = await (await fetch(`${BASE}/api/posts/${postId}`, { headers: H(viewerCookie) })).json();
  publicPost.post?.id === postId && publicPost.media?.length === 2
    ? ok("GET published post as viewer -> post + media")
    : no(`public post body=${JSON.stringify(publicPost)}`);

  const forYou = await (await fetch(`${BASE}/api/feed?tab=for-you`, { headers: H(viewerCookie) })).json();
  forYou.posts?.some((p: { id: string }) => p.id === postId) ? ok("For You feed includes published post") : no("For You missing post");

  const verified = await (await fetch(`${BASE}/api/feed?tab=verified`, { headers: H(viewerCookie) })).json();
  verified.posts?.some((p: { id: string }) => p.id === postId) ? ok("Verified feed includes booking-backed post") : no("Verified missing post");

  const destination = await (await fetch(`${BASE}/api/feed?tab=destination&destination=Tokyo`, { headers: H(viewerCookie) })).json();
  destination.posts?.some((p: { id: string }) => p.id === postId) ? ok("Destination feed includes Tokyo post") : no("Destination missing post");

  const follow = await fetch(`${BASE}/api/follow`, {
    method: "POST",
    headers: H(viewerCookie),
    body: JSON.stringify({ followingId: author.id })
  });
  follow.status === 201 ? ok("POST /api/follow -> 201") : no(`follow status=${follow.status}`);

  const following = await (await fetch(`${BASE}/api/feed?tab=following`, { headers: H(viewerCookie) })).json();
  following.posts?.some((p: { id: string }) => p.id === postId) ? ok("Following feed includes followed author") : no("Following missing post");

  const react = await fetch(`${BASE}/api/posts/${postId}/react`, {
    method: "POST",
    headers: H(viewerCookie),
    body: JSON.stringify({ kind: "love" })
  });
  react.status === 200 ? ok("POST react visible post -> 200") : no(`react status=${react.status}`);

  const changeReaction = await fetch(`${BASE}/api/posts/${postId}/react`, {
    method: "POST",
    headers: H(viewerCookie),
    body: JSON.stringify({ kind: "wow" })
  });
  changeReaction.status === 200 ? ok("POST change reaction visible post -> 200") : no(`change reaction status=${changeReaction.status}`);

  const save = await fetch(`${BASE}/api/posts/${postId}/save`, {
    method: "POST",
    headers: H(viewerCookie),
    body: JSON.stringify({ collectionName: "Tokyo ideas" })
  });
  save.status === 200 ? ok("POST save visible post -> 200") : no(`save status=${save.status}`);

  const comment = await fetch(`${BASE}/api/posts/${postId}/comment`, {
    method: "POST",
    headers: H(viewerCookie),
    body: JSON.stringify({ body: "This verified stay is useful." })
  });
  comment.status === 201 ? ok("POST comment visible post -> 201") : no(`comment status=${comment.status}`);
  const commentBody = await comment.json().catch(() => ({}));
  const parentCommentId = commentBody.comment?.id;

  const reply = await fetch(`${BASE}/api/posts/${postId}/comment`, {
    method: "POST",
    headers: H(authorCookie),
    body: JSON.stringify({ body: "Thanks, this was linked to the actual booking.", parentId: parentCommentId })
  });
  reply.status === 201 ? ok("POST reply visible post -> 201") : no(`reply status=${reply.status}`);

  const comments = await (await fetch(`${BASE}/api/posts/${postId}/comment`, { headers: H(viewerCookie) })).json();
  comments.comments?.length === 2 && comments.comments?.some((c: { parent_id: string | null }) => c.parent_id === parentCommentId)
    ? ok("GET comments returns thread with reply")
    : no(`comments body=${JSON.stringify(comments)}`);

  const stayHere = await fetch(`${BASE}/api/posts/${postId}/stay-here`, {
    method: "POST",
    headers: H(viewerCookie)
  });
  const stayHereBody = await stayHere.json();
  stayHere.status === 200 && stayHereBody.attribution?.attribution_type === "click"
    ? ok("POST Stay here records click attribution")
    : no(`stay-here status=${stayHere.status} body=${JSON.stringify(stayHereBody)}`);

  const patchedByOther = await fetch(`${BASE}/api/posts/${postId}`, {
    method: "PATCH",
    headers: H(otherCookie),
    body: JSON.stringify({ title: "not mine" })
  });
  patchedByOther.status === 404 ? ok("PATCH as another traveler -> 404") : no(`other patch status=${patchedByOther.status}`);

  const privateCreate = await fetch(`${BASE}/api/posts`, {
    method: "POST",
    headers: H(authorCookie),
    body: JSON.stringify({
      title: "Private feed post",
      caption: "This should not appear publicly.",
      visibility: "private",
      destination: "Tokyo"
    })
  });
  const privateBody = await privateCreate.json();
  privatePostId = privateBody.post?.id;
  await fetch(`${BASE}/api/posts/${privatePostId}/publish`, { method: "POST", headers: H(authorCookie) });
  const feedAfterPrivate = await (await fetch(`${BASE}/api/feed`, { headers: H(viewerCookie) })).json();
  feedAfterPrivate.posts?.some((p: { id: string }) => p.id === privatePostId)
    ? no("private published post leaked")
    : ok("feed excludes private published post");

  const del = await fetch(`${BASE}/api/posts/${postId}`, { method: "DELETE", headers: H(authorCookie) });
  del.status === 200 ? ok("DELETE own post -> 200") : no(`delete status=${del.status}`);

  const feedAfterDelete = await (await fetch(`${BASE}/api/feed`, { headers: H(viewerCookie) })).json();
  feedAfterDelete.posts?.some((p: { id: string }) => p.id === postId)
    ? no("deleted post still visible")
    : ok("feed excludes deleted post");
} finally {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
  await queryAurora(`delete from travel_posts where id = any($1::uuid[])`, [[postId, privatePostId].filter(Boolean)]).catch(() => {});
  if (bookingId) await queryAurora(`delete from bookings where id = $1`, [bookingId]).catch(() => {});
  if (listingId) await queryAurora(`delete from listings where id = $1`, [listingId]).catch(() => {});
  await queryAurora(`delete from users where id = any($1::uuid[])`, [[host.id, author.id, viewer.id, other.id]]).catch(() => {});
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
