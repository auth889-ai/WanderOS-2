import { DetailerInput } from "./schema";
import { NearbyPlaces } from "./places";

/** Builds the detailer instruction — Airbnb-depth structuring, grounded in real per-room + places data. */
export function buildDetailerPrompt(input: DetailerInput, places: NearbyPlaces): string {
  const rooms = input.rooms
    .map((r, i) => `  ${i + 1}. ${r.roomLabel || r.roomType} — features: ${r.features.join(", ") || "(none)"} | amenities: ${r.amenities.join(", ") || "(none)"}`)
    .join("\n");

  return `You are a senior listing detailer for a PREMIUM short-stay marketplace. Produce structured detail that is
RICHER than a standard Airbnb page for this ${input.category} in ${input.city}, ${input.country}.
Ground EVERYTHING in the evidence below — never invent rooms, amenities, beds, or safety equipment.

PER-ROOM EVIDENCE (from the photos):
${rooms || "  (no room data)"}

FACTS: ${input.bedrooms} bedroom(s), ${input.bathrooms} bathroom(s), sleeps ${input.maxGuests}
BED CONFIGURATION: ${input.bedConfiguration.join("; ") || "(not specified)"}
CONFIRMED AMENITIES: ${input.amenities.join(", ") || "(none)"}
SAFETY FLAGS (these are UNAVAILABLE/unconfirmed — do NOT list them as present): ${input.safetyFlags.join("; ") || "(none)"}
HOST NOTES: ${input.notes}

REAL NEARBY PLACES (from Google Maps — use these for locationHighlights, do NOT invent):
- Attractions: ${places.attractions.join(", ") || "(none found)"}
- Dining: ${places.dining.join(", ") || "(none found)"}
- Transit: ${places.transit.join(", ") || "(none found)"}

PRODUCE
- listingHighlights: 3-5 icon-style callouts (title + one-line subtitle) capturing the strongest reasons to book
  (e.g. {title:"Self check-in", subtitle:"Check yourself in with the keypad."}) — only if supported by evidence.
- roomBreakdown: one entry PER bedroom/bathroom/living/dining you have evidence for, each with concrete details.
- whereYouWillSleep: one entry per BEDROOM with its bed setup (use the bed configuration; if unspecified, infer
  sensibly from the room evidence and say so plainly, e.g. "1 double bed").
- amenityGroups: group the confirmed amenities into Airbnb-style categories (e.g. "Bathroom", "Bedroom & laundry",
  "Entertainment", "Kitchen & dining", "Internet & office", "Parking", "Safety"). Only confirmed amenities.
- whatThisPlaceOffers: the same amenities as a flat de-duplicated list.
- unavailable: amenities NOT confirmed/available — INCLUDE the safety flags (e.g. "Smoke alarm").
- notProvided: items a guest should bring/not expect (infer sensibly; empty if unsure).
- guestAccess: 1-2 sentences on what the guest can access/use (from notes/evidence).
- otherThingsToNote: anything else a guest should know (fees, pets policy detail, event rules) — empty if none.
- safetyProperty: safety/property items CONFIRMED PRESENT only (never list a safety-flagged item here).
- idealFor: the guest segments this property best suits, inferred from size/amenities/location.
- houseRules: checkIn (default "3:00 PM" if unstated), checkOut (default "11:00 AM"), maxGuests, smoking
  (from notes), pets ("Not specified" if unknown), additional (penalties/access rules from the notes).
- locationHighlights: attractions/dining/transit FROM the real places above only, plus gettingAround
  (one line based on the transit/attractions, or "Not specified").
- confidence (0-1) and reasoning.`;
}
