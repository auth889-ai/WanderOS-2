/** The whole ladder, on three different email shapes. */
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
process.env.LLM_EXTRACT_PROVIDER = "bedrock";
process.env.LLM_EXTRACT_MODEL = "global.anthropic.claude-haiku-4-5-20251001-v1:0";

const P = await import("../../lib/travel/extract/pipeline.ts");

const existing = [{
  key: "hotel", label: "Hotel Ocean View check-in", kind: "stay",
  starts_at: "2026-08-04T15:00:00", value: 612.45, currency: "GBP",
  refundable: false, hard_deadline: "2026-08-04T23:00:00",
  source: "official", confidence: 0.97, reference: "4738291055"
}];

const show = (name: string, r: any) => {
  console.log(`\n══ ${name} ══`);
  console.log(`  tiers run   : ${r.tiersRun.join(" -> ")}`);
  console.log(`  found       : ${JSON.stringify(r.tiersFound)}`);
  console.log(`  ${r.summary}`);
  for (const p of r.proposals) {
    console.log(`    [${p.segment.tier}] ${p.reconciliation.classification.toUpperCase()} conf=${p.segment.confidence}`);
    console.log(`      ${p.reconciliation.summary.slice(0, 92)}`);
    if (p.reconciliation.reviewReasons.length)
      console.log(`      review: ${p.reconciliation.reviewReasons.join(", ")}`);
  }
  for (const f of r.attachmentFailures) console.log(`    ! ${f.name}: ${f.reason.slice(0,80)}`);
};

// 1. Airline with Gmail markup — deterministic, exact, model never runs
show("STRUCTURED (JSON-LD)", await P.runPipeline({
  messageId: "m1",
  htmlBody: `<script type="application/ld+json">
  {"@context":"http://schema.org","@type":"FlightReservation","reservationNumber":"XY9911",
   "reservationFor":{"@type":"Flight","flightNumber":"582",
     "airline":{"@type":"Airline","name":"Emirates","iataCode":"EK"},
     "departureAirport":{"@type":"Airport","iataCode":"DXB"},
     "arrivalAirport":{"@type":"Airport","iataCode":"LHR"},
     "departureTime":"2026-08-04T18:35:00+04:00","arrivalTime":"2026-08-04T21:10:00+01:00"}}
  </script>`
}, existing));

// 2. Oversized attachment — defined failure, no truncated read
show("OVERSIZED ATTACHMENT", await P.runPipeline({
  messageId: "m2", textBody: "Itinerary attached.",
  attachments: [{ name: "huge.pdf", contentType: "application/pdf",
                  bytes: new Uint8Array(6 * 1024 * 1024) }]
}, existing));

// 3. Pure prose — only the model can read it
show("UNSTRUCTURED PROSE", await P.runPipeline({
  messageId: "m3",
  textBody: `Dear Ms Rahman, we look forward to welcoming you to Hotel Ocean View
on the 4th of August for seven nights. Reception is staffed until 11pm only.
Total 612.45 GBP on our Saver rate, which cannot be refunded.
Booking ref 4738291055.`
}, existing));
