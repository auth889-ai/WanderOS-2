/**
 * Agent test — quality-gate (host-studio crew). Deterministic Zod gate (no LLM, no DB).
 *   Run: npm run test:agent:gate
 * Cases: valid draft passes · repairs are applied · invalid draft is rejected with errors ·
 * a 'reject' safety verdict blocks publishing even if structurally valid.
 */
export {};
const { qualityGate } = await import("../../../lib/agents/crews/host-studio/agents/quality-gate/agent");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── agent: quality-gate (deterministic Zod gate) ──\n");

const base = {
  title: "Comfortable 2-Bedroom Apartment with Balcony",
  shortDescription: "A 2-bedroom apartment with balcony, kitchen, WiFi, and parking.",
  longDescription: "This 2-bedroom apartment includes a balcony, kitchen, WiFi, and on-site parking for up to 4 guests.",
  highlights: ["Balcony", "Kitchen", "WiFi"],
  price: 3000,
  currency: "BDT",
  bedrooms: 2,
  bathrooms: 1,
  maxGuests: 4,
  amenities: ["WiFi", "kitchen", "parking"],
  tags: ["balcony", "city"],
  safetyVerdict: "approve"
};

// Case 1 — a complete valid draft
const r1 = await qualityGate(base);
r1.valid && r1.publishable && r1.draft !== null ? ok("valid draft → valid + publishable") : no(`r1 valid=${r1.valid} publishable=${r1.publishable}`);

// Case 2 — repairs: duplicate amenities + untrimmed title
const r2 = await qualityGate({ ...base, title: "  Padded Title  ", amenities: ["WiFi", "WiFi", "kitchen"] });
r2.valid ? ok("repairable draft still valid") : no("repairable draft wrongly invalid");
r2.repairs.length > 0 ? ok(`applied safe repairs: ${r2.repairs.join(", ")}`) : no("no repairs recorded");
r2.draft?.amenities.length === 2 ? ok("de-duplicated amenities (3→2)") : no(`amenities=${r2.draft?.amenities.length}`);

// Case 3 — structurally invalid: price 0 + title too short
const r3 = await qualityGate({ ...base, price: 0, title: "Hi" });
!r3.valid && !r3.publishable && r3.errors.length > 0 ? ok("invalid draft → rejected with errors") : no("invalid draft not caught");
r3.draft === null ? ok("invalid draft returns null draft") : no("returned a draft for invalid input");

// Case 4 — structurally valid but safety REJECT → not publishable
const r4 = await qualityGate({ ...base, safetyVerdict: "reject" });
r4.valid && !r4.publishable ? ok("safety 'reject' blocks publishing (valid but not publishable)") : no(`r4 valid=${r4.valid} publishable=${r4.publishable}`);
r4.errors.join(" ").toLowerCase().includes("safety") ? ok("error explains the safety block") : no("no safety error message");

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
