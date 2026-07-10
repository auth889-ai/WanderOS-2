/**
 * P4 service test — listing.service v2: draft flow + lifecycle + RBAC + versioning (no AI, no Redis).
 *   Run: npm run test:svc:listing2
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
const svc = await import("../../lib/services/listing.service");
const { listVersions } = await import("../../lib/db/tables/listing-versions");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── P4: listing.service v2 (draft · lifecycle · RBAC · versioning) ──\n");

const [host] = await queryAurora<{ id: string }>(
  `insert into users (name, email, role) values ('P4 Host', $1, 'host') returning id`,
  [`p4-${randomUUID()}@test.local`]
);
const [other] = await queryAurora<{ id: string }>(
  `insert into users (name, email, role) values ('P4 Other', $1, 'host') returning id`,
  [`p4o-${randomUUID()}@test.local`]
);
const listingId = randomUUID();

// minimal fake crew output (only the fields the service reads)
const draft = {
  title: "AI Draft Title", shortDescription: "short", longDescription: "a long enough description for the listing",
  highlights: ["a", "b"], price: 1500, priceMin: 1200, priceMax: 1800, currency: "AED",
  bedrooms: 1, bathrooms: 1, maxGuests: 2, amenities: ["WiFi", "AC"], tags: ["modern"], vibes: ["chic"],
  category: "apartment", city: "Dubai", country: "UAE", safetyVerdict: "approve", riskLevel: "low",
  hostSummary: "ready", thingsToConfirm: [], readyToPublish: true, confidence: 0.8, reasoning: "ok"
} as unknown as import("../../lib/agents/crews/host-studio/agents/final-composer/schema").ComposedListing;
const details = {
  listingHighlights: [{ title: "X", subtitle: "y" }], roomBreakdown: [{ name: "Bedroom", details: ["king bed"] }],
  whereYouWillSleep: [{ space: "Bedroom", beds: "1 king" }], amenityGroups: [{ category: "Internet", items: ["WiFi"] }],
  whatThisPlaceOffers: ["WiFi"], unavailable: [], notProvided: [], guestAccess: "full", otherThingsToNote: [],
  safetyProperty: [], idealFor: ["couples"],
  houseRules: { checkIn: "3PM", checkOut: "11AM", maxGuests: 2, smoking: "No", pets: "No", additional: [] },
  locationHighlights: { attractions: ["Mall"], dining: [], transit: [], gettingAround: "central" }, confidence: 0.9, reasoning: "ok"
} as unknown as import("../../lib/agents/crews/host-studio/agents/listing-detailer/schema").ListingDetails;

try {
  // 1 — createDraft (placeholder) + idempotent
  const d1 = await svc.createDraft(host.id, { listingId, city: "Dubai", country: "UAE", category: "apartment" });
  d1.id === listingId && d1.status === "draft" ? ok("createDraft → placeholder row (status=draft)") : no(`id=${d1.id} status=${d1.status}`);
  const d2 = await svc.createDraft(host.id, { listingId, city: "Dubai", country: "UAE", category: "apartment" });
  d2.id === d1.id ? ok("createDraft idempotent (same listingId → same row)") : no("created a duplicate draft");

  // 2 — applyStudioDraft (worker writes crew output + version 1)
  const applied = await svc.applyStudioDraft(listingId, { draft, details });
  applied?.title === "AI Draft Title" && Number(applied?.price) === 1500 ? ok("applyStudioDraft wrote the AI draft into the row") : no(`title=${applied?.title} price=${applied?.price}`);
  (applied?.details as { roomBreakdown?: unknown[] })?.roomBreakdown?.length ? ok("premium details persisted on the listing") : no("details not persisted");
  (await listVersions(listingId)).length === 1 ? ok("version 1 snapshot created") : no("no v1 snapshot");

  // 3 — editListing (RBAC + version 2)
  const edited = await svc.editListing(listingId, host.id, { price: 999, title: "Host Edited" });
  edited && Number(edited.price) === 999 && edited.title === "Host Edited" ? ok("host edit applied") : no("edit failed");
  (await listVersions(listingId)).length === 2 ? ok("edit snapshotted version 2") : no("no v2 snapshot");
  const denied = await svc.editListing(listingId, other.id, { price: 1 });
  denied === null ? ok("RBAC — a different host CANNOT edit") : no("RBAC breach: other host edited");

  // 4 — lifecycle transitions
  const pub = await svc.publish(listingId, host.id);
  pub.ok && pub.listing.status === "pending_review" && pub.listing.moderation_status === "pending_review"
    ? ok("publish: draft → pending_review (+ moderation gate)") : no(`publish=${JSON.stringify(pub)}`);
  const pubAgain = await svc.publish(listingId, host.id);
  !pubAgain.ok ? ok(`illegal transition rejected (${pubAgain.ok ? "" : pubAgain.error})`) : no("re-publish should be invalid");

  // 5 — soft delete + hidden from host listings
  const del = await svc.deleteListing(listingId, host.id);
  del.ok && del.listing.status === "deleted" ? ok("soft delete: → deleted") : no(`delete=${JSON.stringify(del)}`);
  (await svc.getHostListings(host.id)).some((l) => l.id === listingId) ? no("deleted listing still shows") : ok("deleted listing hidden from host listings");
} finally {
  await queryAurora(`delete from listings where id = $1`, [listingId]); // cascades versions
  await queryAurora(`delete from users where id = any($1::uuid[])`, [[host.id, other.id]]);
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
