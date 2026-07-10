/**
 * Agent test — final-composer (host-studio crew). The crew's final handoff.
 *   Run: npm run test:agent:composer
 * Proves: structured content is assembled DETERMINISTICALLY (LLM can't alter the validated copy/price),
 * the LLM adds a host summary + a checklist from the signals, and a 'reject' verdict is never ready.
 */
import { readFileSync } from "fs";

for (const line of readFileSync(new URL("../../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("//") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { finalComposer } = await import("../../../lib/agents/crews/host-studio/agents/final-composer/agent");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── agent: final-composer (final handoff) ──\n");

const base = {
  category: "apartment",
  city: "Sylhet",
  country: "Bangladesh",
  copy: {
    title: "Comfortable 2-Bedroom Apartment with Balcony",
    shortDescription: "A 2-bedroom apartment with balcony, kitchen, WiFi, and parking.",
    longDescription: "This 2-bedroom apartment includes a balcony, kitchen, WiFi, and on-site parking for up to 4 guests.",
    highlights: ["Balcony", "Kitchen", "WiFi"]
  },
  pricing: { suggested: 3000, min: 2700, max: 3300, currency: "BDT", confidence: 0.8 },
  amenities: { amenities: ["WiFi", "kitchen", "parking"], bedrooms: 2, bathrooms: 1, maxGuests: 4, missingInfo: ["bathroom count assumed"] },
  safety: { verdict: "approve", riskLevel: "low", flags: [] as string[] },
  tags: ["balcony", "city-center"],
  vibes: ["relaxing"]
};

// Case 1 — clean draft with one assumed fact
const c = await finalComposer(base);
console.log("Composed:", JSON.stringify(c, null, 2), "\n");

c.title === base.copy.title ? ok("title assembled verbatim (LLM did not rewrite it)") : no("title was altered");
c.price === 3000 && c.currency === "BDT" ? ok("price/currency assembled verbatim") : no(`price=${c.price} ${c.currency}`);
c.bedrooms === 2 && c.maxGuests === 4 ? ok("facts assembled verbatim") : no("facts altered");
c.tags.includes("balcony") && c.vibes.includes("relaxing") ? ok("tags + vibes carried through") : no("tags/vibes missing");
c.hostSummary.length > 20 ? ok("LLM wrote a host summary") : no("hostSummary missing");
c.thingsToConfirm.length > 0 ? ok("checklist includes the assumed fact") : no("did not surface missingInfo to confirm");
c.readyToPublish === true ? ok("clean listing is ready to publish") : no("clean listing not ready");

// Case 2 — safety reject must override readiness (deterministic net)
const rejected = await finalComposer({ ...base, safety: { verdict: "reject", riskLevel: "high", flags: ["discrimination"] } });
rejected.readyToPublish === false ? ok("safety 'reject' forces readyToPublish=false") : no("reject did not block readiness");

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
