import { z } from "zod";
import { flexStringArray, confidence01, flexObjectArray } from "@/lib/ai/zod-helpers";

/** typed views over the flexible object arrays (the transform erases the literal shape) */
export type HighlightItem = { title: string; subtitle: string };
export type RoomItem = { name: string; details: string[] };
export type SleepItem = { space: string; beds: string };
export type AmenityGroup = { category: string; items: string[] };

/**
 * listing-detailer — produces the PREMIUM, Airbnb-grade structured detail of the listing.
 * Goes beyond a basic Airbnb page: icon-style listing highlights, per-bedroom sleep config,
 * category-grouped amenities, guest access, things-to-note, a POSITIVE safety/property list,
 * "ideal for" guest fit, full house rules, and real nearby-places location highlights.
 * Everything is grounded in data already computed (per-room vision, amenities, bed config, safety
 * flags) plus a real Google Maps nearby-places lookup — never invented.
 */
export type DetailerRoom = { roomType: string; roomLabel: string; features: string[]; amenities: string[] };

export type DetailerInput = {
  category: string;
  city: string;
  country: string;
  notes: string;
  rooms: DetailerRoom[]; // from the per-photo vision analyses
  amenities: string[]; // canonical, from amenities-extractor
  bedConfiguration: string[]; // from amenities-extractor (e.g. ["1 king", "2 singles"])
  maxGuests: number;
  bedrooms: number;
  bathrooms: number;
  safetyFlags: string[]; // from trust-safety (e.g. "no smoke alarm")
};

export const ListingDetailsSchema = z.object({
  // Airbnb-style icon callouts (the 3-5 strongest "why book this" moments)
  listingHighlights: flexObjectArray({
    title: { aliases: ["name", "heading", "label"], kind: "string" },
    subtitle: { aliases: ["description", "subTitle", "text", "detail"], kind: "string" }
  }).describe("3-5 standout highlights, each {title, subtitle} (e.g. {title:'Self check-in', subtitle:'Check yourself in with the keypad.'})"),

  // "The space" — room by room
  roomBreakdown: flexObjectArray({
    name: { aliases: ["room", "roomName", "title", "label", "space"], kind: "string", fallback: "Room" },
    details: { aliases: ["items", "features", "description"], kind: "stringArray" }
  }).describe("room-by-room, e.g. { name:'Bedroom 1', details:['1 king bed','Air conditioning','Wardrobe'] }"),

  // "Where you'll sleep" — bed configuration per sleeping space
  whereYouWillSleep: flexObjectArray({
    space: { aliases: ["room", "bedroom", "name", "title", "area"], kind: "string", fallback: "Sleeping area" },
    beds: { aliases: ["bedConfiguration", "bedConfig", "configuration", "bed"], kind: "string" }
  }).describe("per sleeping space, e.g. { space:'Bedroom 1', beds:'1 king bed, 2 single beds' } — grounded in the bed configuration"),

  // "What this place offers" — grouped (Airbnb-style sections) + a flat list
  amenityGroups: flexObjectArray({
    category: { aliases: ["name", "group", "title", "section"], kind: "string", fallback: "Other" },
    items: { aliases: ["amenities", "list", "values"], kind: "stringArray" }
  }).describe("confirmed amenities grouped by category, e.g. {category:'Bathroom', items:['Shower','Hair dryer']}"),
  whatThisPlaceOffers: flexStringArray.describe("flat guest-facing amenity list (deduped, titled)"),
  unavailable: flexStringArray.describe("notable amenities NOT available/confirmed (e.g. 'Smoke alarm') — from safety flags"),
  notProvided: flexStringArray.describe("items the host does NOT provide (inferred sensibly; empty if unknown)"),

  // Guest-facing context
  guestAccess: z.string().describe("what parts of the property the guest can access/use (1-2 sentences)"),
  otherThingsToNote: flexStringArray.describe("anything else a guest should know (from notes/category) — empty if none"),
  safetyProperty: flexStringArray.describe("safety/property items PRESENT & confirmed (e.g. 'Smoke alarm','Exterior security cameras') — only what's supported"),
  idealFor: flexStringArray.describe("guest segments this best suits (e.g. 'Families','Remote workers','Couples')"),

  houseRules: z.object({
    checkIn: z.string().describe("check-in window (default '3:00 PM' if unstated — host edits)"),
    checkOut: z.string().describe("checkout time (default '11:00 AM' if unstated)"),
    maxGuests: z.number().describe("max guests"),
    smoking: z.string().describe("smoking policy from notes (e.g. 'No smoking')"),
    pets: z.string().describe("pet policy (state 'Not specified' if unknown)"),
    additional: flexStringArray.describe("other rules from the notes (penalties, access cards, etc.)")
  }),
  locationHighlights: z.object({
    attractions: flexStringArray.describe("nearby attractions (from the real places lookup)"),
    dining: flexStringArray.describe("nearby restaurants/cafes"),
    transit: flexStringArray.describe("nearby transit/stations"),
    gettingAround: z.string().describe("a one-line 'getting around' note based on the transit/attractions — or 'Not specified'")
  }),
  confidence: confidence01,
  reasoning: z.string()
});

export type ListingDetails = z.infer<typeof ListingDetailsSchema>;
