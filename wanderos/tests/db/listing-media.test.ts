/**
 * c3 test — lib/db/tables/listing-media.ts (the listing_media table).
 *   Run: npm run test:db:listing-media
 * Tests the REAL module functions (insertMany, listByListing, imageUrls) against Aurora.
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
const { createListing } = await import("../../lib/db/tables/listings");
const { insertMany, listByListing, imageUrls } = await import("../../lib/db/tables/listing-media");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── c3: listing-media table ──\n");

const host = (await queryAurora<{ id: string }>("select id from users where role='host' limit 1"))[0];
if (!host) throw new Error("seed a host first: npm run seed:demo");

const listing = await createListing({
  hostId: host.id,
  title: "C3_TEST Media Listing",
  description: "d",
  city: "Sylhet",
  country: "Bangladesh",
  category: "apartment",
  price: 1000
});

try {
  const media = await insertMany(listing.id, [
    { url: "a.jpg", caption: "living" },
    { url: "b.jpg" }
  ]);
  media.length === 2 ? ok("insertMany inserts 2 rows") : no(`insertMany count = ${media.length}`);

  const list = await listByListing(listing.id);
  list.length === 2 && list[0].sort_order === 0 && list[1].sort_order === 1
    ? ok("listByListing returns rows in order")
    : no("listByListing order wrong");

  const urls = await imageUrls(listing.id);
  JSON.stringify(urls) === JSON.stringify(["a.jpg", "b.jpg"])
    ? ok("imageUrls returns image urls in order")
    : no(`imageUrls = ${JSON.stringify(urls)}`);
} finally {
  await queryAurora("delete from listings where id = $1", [listing.id]); // cascade-deletes media
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
