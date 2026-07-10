/**
 * Agent test — vision-aggregator (host-studio crew).
 *   Run: npm run test:agent:aggregator
 * Feeds REAL per-photo analyses (bedroom + messy kitchen + balcony, NO bathroom) and asserts the
 * agent synthesizes a coherent profile that flags the coverage gap + the cleanliness contradiction.
 */
import { readFileSync } from "fs";

for (const line of readFileSync(new URL("../../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("//") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { visionAggregator } = await import("../../../lib/agents/crews/host-studio/agents/vision-aggregator/agent");
const mod = await import("../../../lib/agents/crews/host-studio/agents/property-vision/schema");
type PhotoAnalysis = import("../../../lib/agents/crews/host-studio/agents/property-vision/schema").PhotoAnalysis;

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── agent: vision-aggregator (synthesis) ──\n");

const sample = (over: Partial<PhotoAnalysis>): PhotoAnalysis => ({
  roomType: "living-room",
  roomLabel: "",
  features: [],
  amenities: [],
  condition: "good",
  cleanliness: "tidy",
  lighting: "natural",
  spaciousness: "comfortable",
  style: "modern",
  qualityScore: 80,
  photoQuality: "high",
  highlights: [],
  issues: [],
  improvementTips: [],
  sellingAngle: "",
  confidence: 0.8,
  reasoning: "",
  ...over
});

void mod;
const analyses: PhotoAnalysis[] = [
  sample({ roomType: "bedroom", roomLabel: "master bedroom", amenities: ["AC", "wardrobe"], highlights: ["king bed"], qualityScore: 85 }),
  sample({ roomType: "kitchen", roomLabel: "kitchen", amenities: ["oven", "fridge"], cleanliness: "messy", issues: ["clutter on counter"], qualityScore: 60 }),
  sample({ roomType: "balcony", roomLabel: "balcony with hill view", features: ["hill view"], highlights: ["panoramic view"], condition: "excellent", qualityScore: 95 })
];

const profile = await visionAggregator({ category: "apartment", notes: "Cozy 2BR near tea gardens, hill view.", analyses });
console.log("PropertyProfile:", JSON.stringify(profile, null, 2), "\n");

profile.roomsCovered.length >= 3 ? ok("covered all 3 room types") : no(`roomsCovered=${profile.roomsCovered.length}`);
profile.missingRooms.length > 0 ? ok("flagged coverage gaps (e.g. no bathroom)") : no("missed the bathroom coverage gap");
profile.allAmenities.length >= 3 ? ok("merged amenities across photos") : no(`allAmenities=${profile.allAmenities.length}`);
["poor", "fair", "good", "excellent"].includes(profile.overallCondition) ? ok("overallCondition valid") : no(`overallCondition=${profile.overallCondition}`);
profile.overallQuality >= 0 && profile.overallQuality <= 100 ? ok("overallQuality in 0-100") : no(`overallQuality=${profile.overallQuality}`);
["sparse", "adequate", "comprehensive"].includes(profile.photoCoverage) ? ok("photoCoverage valid") : no(`photoCoverage=${profile.photoCoverage}`);
Array.isArray(profile.contradictions) ? ok("contradictions present (array)") : no("contradictions not array");
profile.confidence >= 0 && profile.confidence <= 1 ? ok("confidence in 0-1") : no(`confidence=${profile.confidence}`);
profile.reasoning.length > 10 ? ok("produced reasoning") : no("reasoning missing");

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
