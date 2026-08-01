/** Transactional commit against the REAL database. */
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}


const I = await import("../../lib/db/tables/ingestion.ts");
const { queryAurora } = await import("../../lib/db/pool.ts");

const trip = (await queryAurora<{id:string}>(
  `select id from trips where title='London, August' order by created_at desc limit 1`))[0].id;
console.log(`  trip ${trip}`);

const MSG = `e2e-${Date.now()}`;

console.log("\n── idempotent import ──");
const a = await I.recordImport({ messageId: MSG, tripId: trip, from: "noreply@booking.com",
  subject: "Hotel Ocean View confirmed", rawRef: "s3://inbound/x.json", attachmentCount: 1 });
const b = await I.recordImport({ messageId: MSG, tripId: trip });
console.log(`  first  alreadySeen=${a.alreadySeen}`);
console.log(`  second alreadySeen=${b.alreadySeen}  same row: ${a.row.id === b.row.id}`);

console.log("\n── extraction + evidence ──");
const ex = await I.recordExtraction({
  importId: a.row.id, tier: "ocr", classification: "new", payload: { reference: "4738291055" },
  confidence: 0.75, requiresReview: true, reviewReasons: ["hard_deadline","refundability"],
  evidence: [{ field: "departsAt", text: "Check-in: Tuesday 4 August 2026, from 15:00", page: 1, ref: "s3://inbound/x.png" },
             { field: "amount", text: "Total price: GBP 612.45", page: 1 }]
});
console.log(`  extraction ${ex.id.slice(0,8)} tier=${ex.tier} review=${ex.requires_review}`);
console.log(`  reasons: ${ex.review_reasons.join(", ")}`);

console.log("\n── correction stored SEPARATELY from extraction ──");
await I.recordCorrection({ extractionId: ex.id, field: "departsAt",
  originalValue: "Tuesday 4 August 2026, from 15:00", correctedValue: "2026-08-04T15:00:00+01:00" });
const rv = await I.loadForReview(a.row.id);
console.log(`  extractions=${rv.extractions.length} corrections=${rv.corrections.length} evidence=${rv.evidence.length}`);
console.log(`  original still intact: ${JSON.stringify(rv.extractions[0].payload)}`);

console.log("\n── transactional commit ──");
const c1 = await I.commitExtraction({
  tripId: trip, importId: a.row.id, extractionId: ex.id,
  commitment: { key: "hotel_e2e", label: "Hotel Ocean View check-in", kind: "stay",
    starts: "2026-08-04T15:00:00", value: 612.45, currency: "GBP", refundable: false,
    hardDeadline: "2026-08-04T23:00:00", consequence: "No late check-in on this rate",
    reference: `REF-${MSG}`, source: "third_party", confidence: 0.75 },
  dependencies: [{ upstream: "flight", downstream: "hotel_e2e", slackMinutes: 45, note: "last train" }]
});
console.log(`  committed key=${c1.commitmentKey} created=${c1.created} outbox=${c1.outboxId.slice(0,8)}`);

console.log("\n── double approval must NOT duplicate ──");
const c2 = await I.commitExtraction({
  tripId: trip, importId: a.row.id, extractionId: ex.id,
  commitment: { key: "hotel_e2e", label: "Hotel Ocean View check-in", kind: "stay",
    starts: "2026-08-04T15:00:00", value: 612.45, refundable: false, reference: `REF-${MSG}` }
});
console.log(`  second commit created=${c2.created} (false = updated, not inserted)`);
const n = await queryAurora<{c:string}>(
  `select count(*) c from trip_commitments where trip_id=$1 and key='hotel_e2e'`, [trip]);
console.log(`  rows for hotel_e2e: ${n[0].c}`);

console.log("\n── outbox pending ──");
for (const o of (await I.pendingOutbox(5))) console.log(`  ${o.event_type} ${JSON.stringify(o.payload).slice(0,64)}`);
