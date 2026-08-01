const R = await import("../../lib/travel/extract/reconcile.ts");

const existing = [{
  key: "hotel", label: "Hotel Ocean View check-in", kind: "stay",
  starts_at: "2026-08-04T15:00:00", value: 612.45, currency: "GBP",
  refundable: false, hard_deadline: "2026-08-04T23:00:00",
  source: "official", confidence: 0.97, reference: "4738291055"
}];

const base = {
  kind: "lodging" as const, reference: "4738291055", carrier: "Hotel Ocean View",
  number: null, from: null, to: null, departsAt: "2026-08-04T15:00:00",
  arrivesAt: null, timezoneUnknown: false, passenger: null, seat: null,
  tier: "json-ld" as const, confidence: 0.97
};

const show = (name: string, r: any) => {
  console.log(`  ${name.padEnd(26)} ${r.classification.toUpperCase().padEnd(13)} review=${r.requiresReview}`);
  console.log(`    ${r.summary.slice(0, 96)}`);
  if (r.reviewReasons.length) console.log(`    reasons: ${r.reviewReasons.join(", ")}`);
};

console.log("── classification ──");
show("identical resend", R.reconcile(base, existing));
show("new booking", R.reconcile({ ...base, reference: "999", departsAt: "2026-09-01T10:00:00" }, existing));
show("schedule change", R.reconcile({ ...base, departsAt: "2026-08-04T19:30:00" }, existing));
show("cancellation", R.reconcile(base, existing, { rawText: "Your booking has been cancelled and refunded in full." }));

console.log("\n── a weaker source must not silently overwrite ──");
const downgrade = R.reconcile(
  { ...base, tier: "model", confidence: 0.4, departsAt: "2026-08-04T19:30:00" }, existing);
console.log(`  ${downgrade.classification} review=${downgrade.requiresReview}`);
console.log(`  ${downgrade.summary.slice(0, 120)}`);
console.log(`  wouldDowngrade: ${downgrade.changes.map((c: any) => c.wouldDowngrade).join(",")}`);

console.log("\n── the five fields that always force review ──");
const cases: Array<[string, any, any]> = [
  ["inferred year",       { ...base, reference: "N1", tier: "model", confidence: 0.4, departsAt: "2027-01-01" }, undefined],
  ["unqualified timezone",{ ...base, reference: "N2", departsAt: "2026-12-01T10:00:00", timezoneUnknown: true }, undefined],
  ["unresolved airport",  { ...base, reference: "N3", kind: "flight", from: "Lon", departsAt: "2026-12-02" }, undefined],
  ["hard deadline",       { ...base, reference: "N4", departsAt: "2026-12-03" }, { hardDeadline: "2026-12-03T23:00:00" }],
  ["refundability",       { ...base, reference: "N5", tier: "model", departsAt: "2026-12-04" }, { refundable: false }]
];
for (const [name, seg, terms] of cases) {
  const r = R.reconcile(seg, existing, { terms });
  console.log(`  ${name.padEnd(22)} review=${String(r.requiresReview).padEnd(5)} ${r.reviewReasons.join(", ")}`);
}
