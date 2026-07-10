/**
 * Agent test — trust-safety-reviewer (host-studio crew, CLAUDE via OpenRouter — 4th provider).
 *   Run: npm run test:agent:safety
 * Two cases: a CLEAN listing should pass; a DISCRIMINATORY one must be caught (not approved).
 */
import { readFileSync } from "fs";

for (const line of readFileSync(new URL("../../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("//") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { trustSafetyReviewer } = await import("../../../lib/agents/crews/host-studio/agents/trust-safety-reviewer/agent");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── agent: trust-safety-reviewer (Claude) ──\n");

// Case 1 — a clean, honest listing
const clean = await trustSafetyReviewer({
  category: "apartment",
  title: "Serene 2BR Retreat with Hill Views",
  description: "A cozy 2-bedroom apartment near the tea gardens with a balcony, WiFi, and a full kitchen.",
  notes: "Quiet neighborhood, great for couples and small families.",
  amenities: ["WiFi", "kitchen", "parking"],
  houseRules: ["no smoking"]
});
console.log("CLEAN verdict:", JSON.stringify(clean, null, 2), "\n");
["approve", "flag", "reject"].includes(clean.verdict) ? ok("clean: returned a valid verdict") : no(`verdict=${clean.verdict}`);
clean.verdict !== "reject" ? ok("clean listing was NOT rejected") : no("clean listing wrongly rejected");
clean.riskLevel !== "high" ? ok("clean listing not rated high risk") : no(`clean riskLevel=${clean.riskLevel}`);

// Case 2 — a discriminatory listing that MUST be caught
const bad = await trustSafetyReviewer({
  category: "apartment",
  title: "Room for rent — Females only, no children, locals only",
  description: "Renting to single women only. No kids, no foreigners, no disabled tenants. Pay cash in advance off-platform.",
  notes: "Strictly females, no children allowed.",
  amenities: ["WiFi"],
  houseRules: ["no children", "females only"]
});
console.log("BAD verdict:", JSON.stringify(bad, null, 2), "\n");
bad.verdict !== "approve" ? ok("discriminatory listing was NOT approved (flagged/rejected)") : no("FAILED to catch discrimination");
bad.flags.length > 0 ? ok("raised flags on the bad listing") : no("no flags on a clearly bad listing");
bad.discriminationCheck.toLowerCase().includes("discrim") || bad.riskLevel === "high"
  ? ok("identified the discrimination / high risk")
  : no("missed the discrimination signal");
bad.confidence >= 0 && bad.confidence <= 1 ? ok("confidence in 0-1") : no(`confidence=${bad.confidence}`);

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
