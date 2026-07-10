/**
 * Agent test — listing-detailer (host-studio crew). Airbnb-depth structuring + real places.
 *   Run: npm run test:agent:detailer
 * Asserts room-by-room breakdown, unavailable safety items, house rules, and REAL nearby places.
 */
import { readFileSync } from "fs";

for (const line of readFileSync(new URL("../../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("//") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { listingDetailer } = await import("../../../lib/agents/crews/host-studio/agents/listing-detailer/agent");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── agent: listing-detailer (Airbnb-depth) ──\n");

const details = await listingDetailer({
  category: "apartment",
  city: "Kuala Lumpur",
  country: "Malaysia",
  notes: "Modern 3-bedroom near KLCC. No smoking (RM500 penalty). One access card only.",
  rooms: [
    { roomType: "bedroom", roomLabel: "Master bedroom", features: ["king bed", "wardrobe"], amenities: ["air conditioning"] },
    { roomType: "bedroom", roomLabel: "Second bedroom", features: ["king bed"], amenities: ["air conditioning"] },
    { roomType: "bathroom", roomLabel: "Bathroom", features: ["walk-in shower", "water heater"], amenities: ["towels"] },
    { roomType: "living-room", roomLabel: "Living room", features: ["sofa", "smart TV"], amenities: ["wifi", "air conditioning"] }
  ],
  amenities: ["WiFi", "Air conditioning", "Smart TV", "Kitchen", "Walk-in shower", "Free parking"],
  bedConfiguration: ["Master: 1 king bed", "Second: 1 king bed", "Third: 2 queen beds"],
  maxGuests: 6,
  bedrooms: 3,
  bathrooms: 2,
  safetyFlags: ["Smoke alarm not confirmed", "Carbon monoxide alarm not confirmed"]
});

console.log("Details:", JSON.stringify(details, null, 2), "\n");

details.roomBreakdown.length >= 3 ? ok(`room-by-room breakdown (${details.roomBreakdown.length} rooms)`) : no(`rooms=${details.roomBreakdown.length}`);
details.roomBreakdown.some((r) => /bedroom/i.test(r.name) && r.details.length > 0) ? ok("a bedroom has concrete details") : no("bedroom details missing");
// PREMIUM enrichments
details.listingHighlights.length >= 2 && details.listingHighlights.every((h) => h.title && h.subtitle) ? ok(`listing highlights (${details.listingHighlights.length}, title+subtitle)`) : no(`listingHighlights=${details.listingHighlights.length}`);
details.whereYouWillSleep.length >= 1 && details.whereYouWillSleep.every((b) => b.space && b.beds) ? ok(`where-you'll-sleep bed config (${details.whereYouWillSleep.length} spaces)`) : no("whereYouWillSleep missing bed config");
details.amenityGroups.length >= 2 && details.amenityGroups.every((g) => g.category && g.items.length >= 0) ? ok(`grouped amenities (${details.amenityGroups.map((g) => g.category).slice(0, 3).join(", ")})`) : no(`amenityGroups=${details.amenityGroups.length}`);
details.whatThisPlaceOffers.length >= 4 ? ok("what-this-place-offers list") : no(`offers=${details.whatThisPlaceOffers.length}`);
details.unavailable.join(" ").toLowerCase().includes("smoke") ? ok("flagged unavailable smoke alarm (from safety)") : no("did not surface the safety flag");
!details.safetyProperty.join(" ").toLowerCase().includes("smoke") ? ok("safetyProperty does NOT list the flagged-missing smoke alarm (honest)") : no("listed a flagged-missing safety item as present");
details.guestAccess.length > 0 ? ok("guest access written") : no("guestAccess empty");
details.idealFor.length > 0 ? ok(`ideal-for guest fit (${details.idealFor.slice(0, 2).join(", ")})`) : no("idealFor empty");
details.houseRules.maxGuests === 6 ? ok("house rules: maxGuests") : no(`maxGuests=${details.houseRules.maxGuests}`);
details.houseRules.smoking.toLowerCase().includes("no") ? ok("house rules: no-smoking from notes") : no(`smoking=${details.houseRules.smoking}`);
details.houseRules.checkIn.length > 0 && details.houseRules.checkOut.length > 0 ? ok("house rules: check-in/out times") : no("check-in/out missing");
details.locationHighlights.attractions.length > 0 ? ok(`REAL nearby attractions (${details.locationHighlights.attractions.slice(0, 2).join(", ")})`) : no("no attractions (Maps lookup) — check key");
details.confidence >= 0 && details.confidence <= 1 ? ok("confidence in 0-1") : no(`confidence=${details.confidence}`);

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
