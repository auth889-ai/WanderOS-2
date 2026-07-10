/**
 * Service test — listing.service (save draft · edit anytime · read). Run: npm run test:svc:listing
 */
import { readFileSync } from "fs";
import { randomUUID } from "crypto";

for (const line of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("//") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { queryAurora } = await import("../../lib/db/pool");
const svc = await import("../../lib/services/listing.service");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── service: listing.service ──\n");

const host = (await queryAurora<{ id: string }>("select id from users where role='host' limit 1"))[0];
if (!host) throw new Error("seed a host: npm run seed:demo");

const listingId = randomUUID();
const draft = {
  title: "SVCTEST Cozy Loft",
  shortDescription: "A cozy loft.",
  longDescription: "A cozy loft with WiFi and a great view, perfect for a short stay in the city.",
  highlights: ["Great view", "WiFi"],
  price: 1200,
  priceMin: 1000,
  priceMax: 1400,
  currency: "BDT",
  bedrooms: 1,
  bathrooms: 1,
  maxGuests: 2,
  amenities: ["WiFi", "kitchen"],
  tags: ["loft", "city"],
  vibes: ["cozy"],
  category: "apartment",
  city: "Dhaka",
  country: "Bangladesh",
  safetyVerdict: "approve",
  riskLevel: "low",
  hostSummary: "Your loft is ready.",
  thingsToConfirm: [],
  readyToPublish: true,
  confidence: 0.9,
  reasoning: "clean"
};

try {
  const listing = await svc.saveListing({ listingId, hostId: host.id, draft, photoUrls: ["https://example.com/a.jpg", "https://example.com/b.jpg"] });
  listing.id === listingId ? ok("saved under the crew's listingId (embedding matches)") : no(`id=${listing.id}`);
  listing.title === "SVCTEST Cozy Loft" ? ok("title persisted") : no("title wrong");
  Number(listing.price) === 1200 ? ok("price persisted") : no(`price=${listing.price}`);
  listing.moderation_status === "pending_review" ? ok("starts pending_review (admin gate)") : no(`moderation=${listing.moderation_status}`);

  const media = await queryAurora<{ c: string }>("select count(*) c from listing_media where listing_id=$1", [listingId]);
  Number(media[0].c) === 2 ? ok("2 media rows inserted") : no(`media=${media[0].c}`);

  const edited = await svc.editListing(listingId, host.id, { price: 1500, title: "SVCTEST Renamed Loft" });
  edited && Number(edited.price) === 1500 && edited.title === "SVCTEST Renamed Loft" ? ok("edit anytime works (price + title updated)") : no("edit failed");

  const fetched = await svc.getListing(listingId);
  fetched?.title === "SVCTEST Renamed Loft" ? ok("getListing returns the updated row") : no("getListing wrong");

  const mine = await svc.getHostListings(host.id);
  mine.some((l) => l.id === listingId) ? ok("appears in the host's listings") : no("not in host listings");
} finally {
  await queryAurora("delete from listing_media where listing_id=$1", [listingId]);
  await queryAurora("delete from listings where id=$1", [listingId]);
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
