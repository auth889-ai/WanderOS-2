/**
 * c2 test — lib/db/tables/listings.ts (the listings table).
 *   Run: npm run test:db:listings
 * Tests the REAL module functions against Aurora: createListing, getById, listByHost,
 * setModeration, getComparables.
 */
import { readFileSync } from "fs";

// load .env.local into process.env (the db pool reads DATABASE_URL lazily)
for (const line of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("//") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { queryAurora } = await import("../../lib/db/pool");
const { createListing, getById, listByHost, setModeration, getComparables } = await import("../../lib/db/tables/listings");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── c2: listings table ──\n");

const host = (await queryAurora<{ id: string }>("select id from users where role='host' limit 1"))[0];
if (!host) throw new Error("seed a host first: npm run seed:demo");

const CITY = "C2TestCity"; // unique city so getComparables is isolated

const listing = await createListing({
  hostId: host.id,
  title: "C2_TEST Listing",
  description: "a cozy place",
  city: CITY,
  country: "Bangladesh",
  category: "apartment",
  price: 2500,
  bedrooms: 2,
  amenities: ["wifi", "kitchen"],
  qualityScore: 82,
  pricingAnalysis: { suggested: 2500 },
  tags: ["test"]
});

try {
  // createListing
  listing.id && listing.status === "draft" && listing.moderation_status === "pending_review"
    ? ok("createListing inserts (draft, pending_review)")
    : no(`createListing wrong: status=${listing.status} mod=${listing.moderation_status}`);

  // getById
  const fetched = await getById(listing.id);
  fetched && fetched.title === "C2_TEST Listing" && fetched.bedrooms === 2 && fetched.amenities.includes("wifi")
    ? ok("getById returns the listing with detail fields")
    : no("getById mismatch");

  // listByHost
  const mine = await listByHost(host.id);
  mine.some((l) => l.id === listing.id) ? ok("listByHost includes the new listing") : no("listByHost missing it");

  // not a comparable yet (still pending_review)
  const before = await getComparables({ city: CITY, category: "apartment" });
  before.length === 0 ? ok("getComparables excludes non-approved listings") : no(`getComparables leaked ${before.length} pending`);

  // setModeration → approved
  const approved = await setModeration(listing.id, "approved");
  approved && approved.moderation_status === "approved" ? ok("setModeration sets approved") : no("setModeration failed");

  // now it IS a comparable
  const after = await getComparables({ city: CITY, category: "apartment" });
  after.some((c) => c.id === listing.id) ? ok("getComparables includes approved listing (grounded pricing source)") : no("getComparables missing approved");
} finally {
  await queryAurora("delete from listings where id = $1", [listing.id]);
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
