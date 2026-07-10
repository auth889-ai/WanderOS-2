/**
 * E2E — the Airbnb-style listing detail page renders all premium sections + RBAC (owner only).
 *   Run: npm run test:e2e:detail
 * Seeds a rich listing directly (no crew), then renders /host/listings/[id] via the dev server and
 * asserts every section is present. Also: a different host gets 404.
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

console.log("\n── E2E: Airbnb-style listing detail page ──\n");

const mk = async (label: string) =>
  (await queryAurora<{ id: string }>(`insert into users (name, email, role) values ($1, $2, 'host') returning id`, [label, `${label}-${randomUUID()}@test.local`]))[0];
const owner = await mk("DetailOwner");
const other = await mk("DetailOther");

const details = {
  photos: ["https://res.cloudinary.com/demo/image/upload/sample.jpg", "https://res.cloudinary.com/demo/image/upload/sample.jpg"],
  listingHighlights: [{ title: "Self check-in", subtitle: "Keypad entry." }, { title: "Designed for staying cool", subtitle: "AC + ceiling fan." }],
  roomBreakdown: [{ name: "Master Bedroom", details: ["King bed", "Air conditioning"] }, { name: "Bathroom", details: ["Walk-in shower"] }],
  whereYouWillSleep: [{ space: "Master Bedroom", beds: "1 king bed" }, { space: "Bedroom 2", beds: "2 single beds" }],
  amenityGroups: [{ category: "Bathroom", items: ["Shower", "Towels"] }, { category: "Internet & office", items: ["WiFi", "Workspace"] }],
  guestAccess: "Entire apartment is yours.",
  otherThingsToNote: ["No smoking (penalty applies)."],
  safetyProperty: ["Smoke alarm", "Security cameras"],
  idealFor: ["Families", "Couples"],
  houseRules: { checkIn: "3:00 PM", checkOut: "11:00 AM", maxGuests: 4, smoking: "No smoking", pets: "Not specified", additional: ["Quiet hours after 10 PM"] },
  locationHighlights: { attractions: ["Burj Khalifa", "Dubai Mall"], dining: ["Zuma"], transit: ["Marina Metro"], gettingAround: "Central and walkable." }
};

const [row] = await queryAurora<{ id: string }>(
  `insert into listings (host_id, title, description, city, country, category, price, bedrooms, bathrooms, max_guests, amenities, details, image_url, status, moderation_status)
   values ($1,'Detail Test Villa','A lovely test villa with a great view and modern design.','Dubai','UAE','villa',2200,2,1,4,$2,$3::jsonb,$4,'draft','draft') returning id`,
  [owner.id, ["WiFi", "AC", "Karaoke room"], JSON.stringify(details), details.photos[0]]
);
const listingId = row.id;

let server: ChildProcess | null = null;
async function waitUp(timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/auth/me`);
      if (r.status > 0) return true;
    } catch {
      /* down */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

try {
  let up = await waitUp(2000);
  if (!up) {
    server = spawn("npm run dev", { cwd: new URL("../../", import.meta.url).pathname, shell: true, detached: true, stdio: "ignore" });
    up = await waitUp();
  }
  up ? ok("dev server reachable") : no("server not reachable");

  const ownerCookie = `${sessionCookieName}=${createSessionToken({ id: owner.id, name: "Owner", email: "o@t.local", role: "host" })}`;
  const otherCookie = `${sessionCookieName}=${createSessionToken({ id: other.id, name: "Other", email: "x@t.local", role: "host" })}`;

  const res = await fetch(`${BASE}/host/listings/${listingId}`, { headers: { Cookie: ownerCookie } });
  const html = await res.text();
  res.status === 200 ? ok("owner GET detail page → 200") : no(`status=${res.status}`);

  const checks: [string, string][] = [
    ["title", "Detail Test Villa"],
    ["highlights section", "What makes it special"],
    ["a highlight", "Self check-in"],
    ["where you'll sleep", "Where you&#x27;ll sleep"],
    ["bed config", "1 king bed"],
    ["the space", "The space"],
    ["room", "Master Bedroom"],
    ["offers section", "What this place offers"],
    ["amenity grid shows each amenity (incl. host-added)", "Karaoke room"],
    ["where you'll be", "Where you&#x27;ll be"],
    ["nearby attraction", "Burj Khalifa"],
    ["things to know", "Things to know"],
    ["house rule", "3:00 PM"],
    ["safety", "Smoke alarm"],
    ["gallery photo", "res.cloudinary.com"]
  ];
  for (const [label, needle] of checks) (html.includes(needle) ? ok : no)(`renders ${label}`);

  // RBAC — a different host cannot view it
  const otherRes = await fetch(`${BASE}/host/listings/${listingId}`, { headers: { Cookie: otherCookie } });
  otherRes.status === 404 ? ok("different host → 404 (RBAC)") : no(`other host status=${otherRes.status}`);
} finally {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
  await queryAurora(`delete from listings where id = $1`, [listingId]).catch(() => {});
  await queryAurora(`delete from users where id = any($1::uuid[])`, [[owner.id, other.id]]).catch(() => {});
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
