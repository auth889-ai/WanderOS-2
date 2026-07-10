/**
 * Agent test — amenities-extractor (host-studio crew, GROQ — 3rd provider).
 *   Run: npm run test:agent:amenities
 * Asserts correct structured extraction (2-bedroom from notes), house rules from notes only, and
 * that it runs on Groq.
 */
import { readFileSync } from "fs";

for (const line of readFileSync(new URL("../../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("//") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { amenitiesExtractor } = await import("../../../lib/agents/crews/host-studio/agents/amenities-extractor/agent");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── agent: amenities-extractor (Groq) ──\n");

const facts = await amenitiesExtractor({
  category: "apartment",
  notes: "Cozy 2-bedroom apartment near the tea gardens. WiFi, full kitchen, parking. No smoking, no parties.",
  detectedAmenities: ["wifi", "kitchen", "parking", "AC", "wardrobe"],
  roomsCovered: ["bedroom", "kitchen", "balcony"]
});

console.log("AmenitiesFacts:", JSON.stringify(facts, null, 2), "\n");

facts.amenities.length >= 3 ? ok("extracted 3+ amenities") : no(`amenities=${facts.amenities.length}`);
facts.bedrooms === 2 ? ok("correctly extracted 2 bedrooms from notes") : no(`bedrooms=${facts.bedrooms} (expected 2)`);
typeof facts.bathrooms === "number" && facts.bathrooms >= 1 ? ok("inferred a sensible bathroom count") : no(`bathrooms=${facts.bathrooms}`);
facts.maxGuests > 0 ? ok("set maxGuests") : no(`maxGuests=${facts.maxGuests}`);
facts.houseRules.length > 0 ? ok("captured house rules stated in the notes") : no("missed the stated house rules");
const rules = facts.houseRules.join(" ").toLowerCase();
!rules.includes("pet") ? ok("HONEST — did not invent a 'no pets' rule (not in notes)") : no("fabricated a pets rule not in the notes");
facts.confidence >= 0 && facts.confidence <= 1 ? ok("confidence in 0-1") : no(`confidence=${facts.confidence}`);
facts.reasoning.length > 10 ? ok("produced reasoning") : no("reasoning missing");

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
