import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const C = await import("../../lib/db/tables/commitments.ts");
const trip = process.argv[2];
const { commitments, dependencies } = await C.toWorkerPayload(trip);
console.log(`  ${commitments.length} commitments, ${dependencies.length} dependencies from the DB`);

const W = process.env.MEDIA_WORKER_URL || "http://127.0.0.1:8000";
const pulse = await (await fetch(`${W}/journey/pulse`, { method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ destination: "London", start_date: "2026-08-04", end_date: "2026-08-11",
    flight: { flight_iata: "EK582", delay_minutes: 95 }, commitments, dependencies })})).json();
console.log(`\n  PULSE: ${pulse.overall?.toUpperCase()}`);
console.log(`  ${pulse.headline}`);
for (const n of pulse.nodes ?? [])
  console.log(`    [${n.state.padEnd(6)}] ${String(n.label).slice(0,30).padEnd(32)} ${String(n.detail).slice(0,40)}`);

const casc = await (await fetch(`${W}/journey/cascade`, { method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ commitments, dependencies, origin: "flight", delay_minutes: 95 })})).json();
console.log(`\n  CASCADE: expected loss ${casc.currency}${casc.expected_loss}`);
console.log(`  ${casc.headline}`);
for (const a of casc.at_risk ?? [])
  console.log(`    ${a.band.padEnd(6)} ${String(a.risk*100).padStart(3).slice(0,3)}%  ${String(a.commitment).slice(0,34)}`);
