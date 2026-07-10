/**
 * Full E2E - host listing -> marketplace -> traveler booking -> host sees booking.
 *   Run: npm run test:e2e:host-book
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

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

const BASE = "http://localhost:5050";
console.log("\n── FULL E2E: host -> book -> dashboards ──\n");

async function createUser(role: "traveler" | "host", label: string) {
  const [user] = await queryAurora<{ id: string; email: string }>(
    `insert into users (name, email, role) values ($1,$2,$3) returning id, email`,
    [`Full ${label}`, `full-${label}-${randomUUID()}@test.local`, role]
  );
  return user;
}

const host = await createUser("host", "host");
const traveler = await createUser("traveler", "traveler");

const hostCookie = `${sessionCookieName}=${createSessionToken({
  id: host.id,
  name: "Full Flow Host",
  email: host.email,
  role: "host"
})}`;
const travelerCookie = `${sessionCookieName}=${createSessionToken({
  id: traveler.id,
  name: "Full Flow Traveler",
  email: traveler.email,
  role: "traveler"
})}`;

const H = (cookie?: string) => ({ "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) });

let server: ChildProcess | null = null;
let listingId = "";
let bookingId = "";

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
  console.log("booting next dev (port 5050)...");
  server = spawn("npm run dev", { cwd: new URL("../../", import.meta.url).pathname, shell: true, detached: true, stdio: "ignore" });
  const up = await waitForServer();
  up ? ok("dev server is up") : no("dev server did not start in time");
  if (!up) throw new Error("server boot failed");

  const create = await fetch(`${BASE}/api/listings`, {
    method: "POST",
    headers: H(hostCookie),
    body: JSON.stringify({
      title: "Full Flow Kyoto Riverside Stay",
      description: "A verified full-flow test stay with quiet river views, workspace, and fast transit.",
      city: "Kyoto",
      country: "Japan",
      category: "apartment",
      price: 240,
      imageUrl: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
      tags: ["kyoto", "riverside", "workspace"],
      status: "published"
    })
  });
  const created = await create.json().catch(() => ({}));
  listingId = created.listing?.id;
  create.status === 201 && listingId ? ok("host created listing through HTTP API") : no(`create=${create.status} ${JSON.stringify(created)}`);

  await queryAurora(
    `update listings
        set moderation_status = 'approved',
            status = 'published',
            max_guests = 3,
            bedrooms = 1,
            bathrooms = 1,
            amenities = array['WiFi','Workspace','River view']
      where id = $1`,
    [listingId]
  );
  ok("listing approved for public marketplace");

  const hostList = await (await fetch(`${BASE}/api/listings`, { headers: H(hostCookie) })).json();
  hostList.listings?.some((listing: { id: string }) => listing.id === listingId)
    ? ok("host listing appears in host-owned list")
    : no("host listing missing from host list");

  const publicList = await (await fetch(`${BASE}/api/listings`, { headers: H(travelerCookie) })).json();
  publicList.listings?.some((listing: { id: string }) => listing.id === listingId)
    ? ok("approved listing appears in traveler public listing API")
    : no("approved listing missing from public API");

  const marketplace = await fetch(`${BASE}/marketplace`, { headers: H(travelerCookie) });
  const marketplaceHtml = await marketplace.text();
  marketplace.status === 200 && marketplaceHtml.includes("Full Flow Kyoto Riverside Stay")
    ? ok("marketplace page renders approved listing")
    : no(`marketplace=${marketplace.status}`);

  const detail = await fetch(`${BASE}/listing/${listingId}`, { headers: H(travelerCookie) });
  const detailHtml = await detail.text();
  detail.status === 200 && detailHtml.includes("Full Flow Kyoto Riverside Stay")
    ? ok("public listing detail page renders")
    : no(`detail=${detail.status}`);

  const hostBook = await fetch(`${BASE}/api/bookings`, {
    method: "POST",
    headers: H(hostCookie),
    body: JSON.stringify({ listingId, checkIn: "2026-09-10", checkOut: "2026-09-13", guests: 2 })
  });
  hostBook.status === 403 ? ok("host cannot book as traveler") : no(`host booking status=${hostBook.status}`);

  const booking = await fetch(`${BASE}/api/bookings`, {
    method: "POST",
    headers: H(travelerCookie),
    body: JSON.stringify({ listingId, checkIn: "2026-09-10", checkOut: "2026-09-13", guests: 2 })
  });
  const booked = await booking.json().catch(() => ({}));
  bookingId = booked.booking?.id;
  const expectedTotal = 3 * 240;
  booking.status === 201 && bookingId && Number(booked.booking?.total_amount) === expectedTotal
    ? ok("traveler booked listing with correct total")
    : no(`booking=${booking.status} ${JSON.stringify(booked)}`);

  const travelerBookings = await (await fetch(`${BASE}/api/bookings`, { headers: H(travelerCookie) })).json();
  travelerBookings.bookings?.some((item: { id: string; listing_id: string }) => item.id === bookingId && item.listing_id === listingId)
    ? ok("traveler bookings API returns own booking")
    : no("traveler bookings missing booking");

  const hostBookings = await (await fetch(`${BASE}/api/host/bookings`, { headers: H(hostCookie) })).json();
  hostBookings.bookings?.some((item: { id: string; listing_id: string; traveler_id: string }) => item.id === bookingId && item.traveler_id === traveler.id)
    ? ok("host bookings API returns traveler booking")
    : no("host bookings missing traveler booking");

  const dashboard = await fetch(`${BASE}/dashboard`, { headers: H(travelerCookie) });
  await dashboard.text();
  dashboard.status === 200
    ? ok("traveler dashboard renders after booking")
    : no(`dashboard=${dashboard.status}`);
} finally {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
  if (bookingId) await queryAurora(`delete from bookings where id = $1`, [bookingId]).catch(() => {});
  if (listingId) await queryAurora(`delete from listings where id = $1`, [listingId]).catch(() => {});
  await queryAurora(`delete from users where id = any($1::uuid[])`, [[host.id, traveler.id]]).catch(() => {});
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
