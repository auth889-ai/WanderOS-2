/**
 * Agent test — listing-copywriter (host-studio crew, OpenAI).
 *   Run: npm run test:agent:copywriter
 * Runs the REAL agent and asserts rich copy + HONESTY (won't claim features outside the facts).
 */
import { readFileSync } from "fs";

for (const line of readFileSync(new URL("../../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("//") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { listingCopywriter } = await import("../../../lib/agents/crews/host-studio/agents/listing-copywriter/agent");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── agent: listing-copywriter (OpenAI) ──\n");

const copy = await listingCopywriter({
  category: "apartment",
  city: "Sylhet",
  country: "Bangladesh",
  topHighlights: ["panoramic hill view", "king bed", "peaceful neighborhood"],
  allAmenities: ["wifi", "kitchen", "parking", "wardrobe"],
  aestheticStyle: "cozy modern",
  notes: "Cozy 2-bedroom near the tea gardens, balcony with hill view, wifi, kitchen, parking, quiet. No AC, no pool.",
  // confirmed facts — the copy must NOT claim anything outside this list (no AC, no pool)
  facts: { bedrooms: 2, bathrooms: 1, maxGuests: 4, amenities: ["wifi", "kitchen", "parking", "wardrobe"] }
});

console.log("Copy:", JSON.stringify(copy, null, 2), "\n");

copy.title.length > 0 ? ok("wrote a title") : no("title missing");
copy.tagline.length > 0 ? ok("wrote a tagline") : no("tagline missing");
copy.longDescription.length > 80 ? ok("wrote a substantial long description") : no(`longDescription too short (${copy.longDescription.length})`);
copy.highlights.length >= 4 ? ok("4+ highlights") : no(`highlights=${copy.highlights.length}`);
copy.guestPromise.length > 0 ? ok("wrote a guest promise") : no("guestPromise missing");
copy.seoKeywords.length >= 4 ? ok("4+ seo keywords") : no(`seoKeywords=${copy.seoKeywords.length}`);
copy.confidence >= 0 && copy.confidence <= 1 ? ok("confidence in 0-1") : no(`confidence=${copy.confidence}`);

// HONESTY: must not claim the avoided (non-existent) features
const blob = `${copy.title} ${copy.tagline} ${copy.shortDescription} ${copy.longDescription} ${copy.highlights.join(" ")}`.toLowerCase();
!blob.includes("air condition") && !blob.includes("swimming pool") && !blob.includes(" pool")
  ? ok("HONEST — did not claim AC or pool (respected avoid list)")
  : no("claimed an avoided feature (AC/pool)");

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
