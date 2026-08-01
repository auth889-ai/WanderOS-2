/** The full ladder on a MESSY email with zero machine-readable structure. */
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
process.env.LLM_EXTRACT_PROVIDER = "bedrock";
process.env.LLM_EXTRACT_MODEL = "global.anthropic.claude-haiku-4-5-20251001-v1:0";

const S = await import("../../lib/travel/extract/structured.ts");
const M = await import("../../lib/travel/extract/model.ts");

// Deliberately awful: prose, no JSON-LD, no barcode, ambiguous date wording,
// the closing time buried in a sentence, and the refund terms in passing.
const messy = `
Dear Ms Rahman,

Thanks so much for booking with us! We're really looking forward to welcoming
you to Hotel Ocean View on the 4th of August. Your room (a Double Superior,
lovely view over the gardens) is reserved for seven nights.

Just so you know, our reception is only staffed until 11pm — after that the
front door is locked and we can't let anyone in until 7am, so do let us know
if your flight is delayed.

The total comes to 612.45 GBP. As this was booked on our Saver rate I'm afraid
we can't offer any refund if you need to cancel.

Booking ref 4738291055.

Warm regards,
Priya at reception
`;

console.log("── tier 1 (JSON-LD) on messy email ──");
console.log(`  ${S.extractJsonLd(messy).length} segments — nothing to read`);
console.log("── tier 2 (barcode) on messy email ──");
console.log(`  ${S.extractBoardingPass(messy) ? 1 : 0} segments — nothing to read`);

console.log("\n── tier 4: AWS BEDROCK reads the prose ──");
const r = await M.extractWithModel(messy);
if (r.failed) { console.log("  FAILED:", r.failed); process.exit(1); }
for (const s of r.segments) {
  console.log(`  kind       ${s.kind}`);
  console.log(`  property   ${s.carrier}`);
  console.log(`  reference  ${s.reference}`);
  console.log(`  guest      ${s.passenger}`);
  console.log(`  departs    ${s.departsAt}   tz-known: ${!s.timezoneUnknown}`);
  console.log(`  tier       ${s.tier}  confidence ${s.confidence} (capped below deterministic)`);
}
if (r.unreadable.length) console.log(`  unreadable: ${r.unreadable.join(" | ").slice(0,90)}`);

console.log("\n── commercial terms the cascade engine needs ──");
const t = await M.extractTerms(messy);
console.log(`  refundable    ${t.refundable}   <- "can't offer any refund"`);
console.log(`  amount        ${t.amount} ${t.currency}`);
console.log(`  hardDeadline  ${t.hardDeadline}   <- "reception only staffed until 11pm"`);
