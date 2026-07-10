/**
 * Booking flow (no Stripe) — createBooking computes nights×price, RBAC, earnings. Live Aurora.
 *   npx tsx tests/services/booking.test.ts
 */
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
for (const l of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!l.includes("=") || l.trim().startsWith("#")) continue;
  const i = l.indexOf("="); const k = l.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^"|"$/g, "");
}
const { queryAurora } = await import("../../lib/db/pool");
const { createBooking, listTravelerBookings, hostEarnings } = await import("../../lib/services/booking.service");

let pass = 0, fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);
console.log("\n── booking flow ──\n");

const mk = async (role: string) => (await queryAurora<{ id: string }>(`insert into users (name,email,role) values ($1,$2,$3) returning id`, [role, `${role}-${randomUUID()}@t.local`, role]))[0];
const host = await mk("host");
const traveler = await mk("traveler");

const [approved] = await queryAurora<{ id: string }>(
  `insert into listings (host_id,title,description,city,country,category,price,max_guests,status,moderation_status)
   values ($1,'Sea Villa','x','Dubai','UAE','villa',1000,4,'published','approved') returning id`, [host.id]);
const [pending] = await queryAurora<{ id: string }>(
  `insert into listings (host_id,title,description,city,country,category,price,max_guests,status,moderation_status)
   values ($1,'Draft Villa','x','Dubai','UAE','villa',500,2,'pending_review','pending_review') returning id`, [host.id]);

try {
  const ci = "2026-07-01", co = "2026-07-04"; // 3 nights
  const r = await createBooking(traveler.id, { listingId: approved.id, checkIn: ci, checkOut: co, guests: 2 });
  r.ok ? ok("booking created") : no(`create failed: ${r.error}`);
  r.booking?.nights === 3 ? ok("nights = 3") : no(`nights=${r.booking?.nights}`);
  Number(r.booking?.total_amount) === 3000 ? ok("total = 3 × 1000 = 3000") : no(`total=${r.booking?.total_amount}`);
  r.booking?.status === "confirmed" ? ok("status confirmed") : no(`status=${r.booking?.status}`);

  const trips = await listTravelerBookings(traveler.id);
  trips.length === 1 && trips[0].title === "Sea Villa" ? ok("appears in My Trips") : no("not in trips");

  (await hostEarnings(host.id)) === 3000 ? ok("host earnings = 3000") : no("earnings wrong");

  // RBAC / guards
  const own = await createBooking(host.id, { listingId: approved.id, checkIn: ci, checkOut: co, guests: 1 });
  !own.ok ? ok("can't book your own listing → blocked") : no("booked own listing");
  const notApproved = await createBooking(traveler.id, { listingId: pending.id, checkIn: ci, checkOut: co, guests: 1 });
  !notApproved.ok ? ok("can't book a non-approved listing → blocked") : no("booked pending listing");
  const badDates = await createBooking(traveler.id, { listingId: approved.id, checkIn: co, checkOut: ci, guests: 1 });
  !badDates.ok ? ok("checkout before checkin → blocked") : no("accepted bad dates");
} finally {
  await queryAurora(`delete from bookings where host_id=$1`, [host.id]).catch(() => {});
  await queryAurora(`delete from listings where host_id=$1`, [host.id]).catch(() => {});
  await queryAurora(`delete from users where id = any($1::uuid[])`, [[host.id, traveler.id]]).catch(() => {});
}
console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
