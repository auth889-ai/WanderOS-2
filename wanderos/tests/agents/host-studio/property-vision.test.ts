/**
 * Agent test — property-vision (host-studio crew).
 *   Run: npm run test:agent:vision
 * Feeds a REAL local photo (as a data URI) to the agent and asserts a valid PhotoAnalysis.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("//") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { propertyVision } = await import("../../../lib/agents/crews/host-studio/agents/property-vision/agent");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── agent: property-vision (Gemini vision) ──\n");

// load a real local photo as a data URI
const img = readFileSync(join(ROOT, "public/images/hero/hero1.webp"));
const dataUri = `data:image/webp;base64,${img.toString("base64")}`;

const result = await propertyVision({ imageUrl: dataUri, category: "apartment" });
console.log("PhotoAnalysis:", JSON.stringify(result, null, 2), "\n");

typeof result.roomType === "string" && result.roomType.length > 0 ? ok("classified roomType") : no("roomType missing");
typeof result.roomLabel === "string" ? ok("produced a roomLabel") : no("roomLabel missing");
Array.isArray(result.features) && Array.isArray(result.amenities) ? ok("features + amenities arrays") : no("features/amenities not arrays");
["poor", "fair", "good", "excellent"].includes(result.condition) ? ok("condition valid") : no(`condition=${result.condition}`);
["dark", "dim", "natural", "bright"].includes(result.lighting) ? ok("lighting valid") : no(`lighting=${result.lighting}`);
["cramped", "compact", "comfortable", "spacious"].includes(result.spaciousness) ? ok("spaciousness valid") : no(`spaciousness=${result.spaciousness}`);
result.qualityScore >= 0 && result.qualityScore <= 100 ? ok("qualityScore in 0-100") : no(`qualityScore=${result.qualityScore}`);
Array.isArray(result.issues) && Array.isArray(result.improvementTips) ? ok("issues + improvementTips arrays") : no("issues/tips not arrays");
typeof result.sellingAngle === "string" && result.sellingAngle.length > 0 ? ok("produced a sellingAngle") : no("sellingAngle missing");
result.confidence >= 0 && result.confidence <= 1 ? ok("confidence in 0-1") : no(`confidence=${result.confidence}`);
result.reasoning.length > 10 ? ok("produced reasoning") : no("reasoning missing");

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
