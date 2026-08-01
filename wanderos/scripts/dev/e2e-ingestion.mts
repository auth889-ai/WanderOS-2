/**
 * End-to-end: a confirmation email becomes a live commitment that Pulse and
 * Cascade can both see. Every step hits real infrastructure.
 */
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
process.env.LLM_EXTRACT_PROVIDER = "bedrock";
process.env.LLM_EXTRACT_MODEL = "global.anthropic.claude-haiku-4-5-20251001-v1:0";

const P = await import("../../lib/travel/extract/pipeline.ts");
const I = await import("../../lib/db/tables/ingestion.ts");
const C = await import("../../lib/db/tables/commitments.ts");
const { queryAurora } = await import("../../lib/db/pool.ts");

const LAMBDA = process.argv[2] ?? "";
const PW = process.argv[3] ?? "";
const MSG = `e2e-${Date.now()}`;
const step = (n: number, s: string) => console.log(`\n${"─".repeat(3)} ${n}. ${s} ${"─".repeat(Math.max(0, 52 - s.length))}`);

const trip = (await queryAurora<{id:string}>(
  `select id from trips where title='London, August' order by created_at desc limit 1`))[0].id;

const EMAIL = {
  MessageID: MSG,
  From: "reservations@hotelocean.example",
  Subject: "Your stay at Hotel Ocean View is confirmed",
  TextBody: `Dear Ms Rahman,

We look forward to welcoming you to Hotel Ocean View on 4 August 2026 for seven
nights. Reception is staffed until 11pm only; after that the door is locked.

Total 612.45 GBP on our Saver rate, which cannot be refunded.
Booking reference 8891245.`
};

step(1, "POST to the PERMANENT Lambda URL");
if (LAMBDA) {
  const res = await fetch(LAMBDA, {
    method: "POST",
    headers: { "Content-Type": "application/json",
      Authorization: "Basic " + Buffer.from(`postmark_wanderos:${PW}`).toString("base64") },
    body: JSON.stringify(EMAIL)
  });
  console.log(`  HTTP ${res.status}  ${(await res.text()).slice(0, 130)}`);
} else console.log("  (skipped — no URL given)");

step(2, "idempotent import record");
const imp = await I.recordImport({ messageId: MSG, tripId: trip, from: EMAIL.From,
  subject: EMAIL.Subject, rawRef: `inbound/2026/08/01/${MSG}.json` });
console.log(`  import ${imp.row.id.slice(0,8)} alreadySeen=${imp.alreadySeen}`);

step(3, "extraction ladder");
const existing = (await C.listCommitments(trip)).map((c) => ({
  key: c.key, label: c.label, kind: c.kind, starts_at: c.starts_at,
  value: c.value === null ? null : Number(c.value), currency: c.currency,
  refundable: c.refundable, hard_deadline: c.hard_deadline,
  source: c.source, confidence: Number(c.confidence), reference: (c as any).reference
}));
const run = await P.runPipeline({ messageId: MSG, textBody: EMAIL.TextBody }, existing);
console.log(`  tiers: ${run.tiersRun.join(" -> ")}   found: ${JSON.stringify(run.tiersFound)}`);
console.log(`  ${run.summary}`);
const proposal = run.proposals[0];
console.log(`  proposal: ${proposal.reconciliation.classification} conf=${proposal.segment.confidence}`);
console.log(`  terms: refundable=${proposal.terms.refundable} amount=${proposal.terms.amount} ${proposal.terms.currency}`);
console.log(`  hardDeadline=${proposal.terms.hardDeadline}`);
console.log(`  review reasons: ${proposal.reconciliation.reviewReasons.join(", ")}`);

step(4, "persist extraction + evidence");
const ex = await I.recordExtraction({
  importId: imp.row.id, tier: proposal.segment.tier,
  classification: proposal.reconciliation.classification,
  matchedKey: proposal.reconciliation.matchedKey,
  payload: proposal.segment, confidence: proposal.segment.confidence,
  requiresReview: proposal.reconciliation.requiresReview,
  reviewReasons: proposal.reconciliation.reviewReasons,
  evidence: [{ field: "hardDeadline", text: "Reception is staffed until 11pm only", page: null },
             { field: "refundable", text: "Saver rate, which cannot be refunded", page: null }]
});
console.log(`  extraction ${ex.id.slice(0,8)} requires_review=${ex.requires_review}`);

step(5, "human corrects the ambiguous timezone");
await I.recordCorrection({ extractionId: ex.id, field: "departsAt",
  originalValue: String(proposal.segment.departsAt),
  correctedValue: "2026-08-04T15:00:00+01:00" });
const review = await I.loadForReview(imp.row.id);
console.log(`  corrections=${review.corrections.length} evidence=${review.evidence.length}`);
console.log(`  extraction payload UNCHANGED: departsAt=${(review.extractions[0].payload as any).departsAt}`);
console.log(`  correction: ${review.corrections[0].original_value} -> ${review.corrections[0].corrected_value}`);

step(6, "transactional commit");
const committed = await I.commitExtraction({
  tripId: trip, importId: imp.row.id, extractionId: ex.id,
  commitment: { key: "hotel_ocean_e2e", label: "Hotel Ocean View check-in", kind: "stay",
    starts: "2026-08-04T15:00:00+01:00", value: proposal.terms.amount, currency: proposal.terms.currency ?? "GBP",
    refundable: proposal.terms.refundable === true,
    hardDeadline: proposal.terms.hardDeadline, consequence: "Reception closes at 23:00",
    reference: "8891245", source: "traveller", confidence: 1.0 },
  dependencies: [{ upstream: "connect", downstream: "hotel_ocean_e2e", slackMinutes: 45,
                   note: "last train from the airport" }]
});
console.log(`  key=${committed.commitmentKey} created=${committed.created} outbox=${committed.outboxId.slice(0,8)}`);

step(7, "database rows");
const rows = await queryAurora<any>(
  `select key,label,value,currency,refundable,hard_deadline,source,reference
     from trip_commitments where trip_id=$1 order by key`, [trip]);
for (const r of rows)
  console.log(`  ${r.key.padEnd(18)} ${String(r.label).slice(0,26).padEnd(28)} ${String(r.value ?? "-").padStart(7)} ${r.currency}  refundable=${r.refundable}  src=${r.source}`);

step(8, "outbox drains -> Pulse + Cascade");
for (const o of await I.pendingOutbox(5)) {
  console.log(`  ${o.event_type}  trip=${String(o.trip_id).slice(0,8)}`);
  await I.markOutboxProcessed(o.id);
}
console.log(`  remaining pending: ${(await I.pendingOutbox(5)).length}`);
