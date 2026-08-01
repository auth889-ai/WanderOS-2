/** Probe live Duffel inventory and report what can actually be held. */
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const { searchOffers, isConfigured, bookingEnabled } = await import("../../lib/travel/duffel.ts");

console.log(`configured=${isConfigured()}  booking_enabled=${bookingEnabled()}`);
const r = await searchOffers({ origin: "DXB", destination: "LHR", departureDate: "2026-08-05" });
if (!r.ok) { console.log("FAILED:", r.reason); process.exit(1); }

console.log(`\n${r.data.length} real offers\n`);
console.log("  carrier                 price    dur   seg bags  HOLD   expires");
for (const o of r.data.slice(0, 8)) {
  const dur = `${Math.floor(o.durationMinutes / 60)}h${String(o.durationMinutes % 60).padStart(2, "0")}`;
  console.log(`  ${o.carrier.slice(0, 20).padEnd(22)}${String(o.amount).padStart(8)} ${o.currency}` +
    `  ${dur}   ${o.segments}   ${o.includedCheckedBags}   ${o.holdable ? "YES" : "no "}   ${o.expiresAt?.slice(5, 16) ?? "-"}`);
}
console.log(`\n  ${r.data.filter(o => o.holdable).length}/${r.data.length} can be HELD without paying`);
console.log(`  ${r.data.filter(o => o.includedCheckedBags > 0).length}/${r.data.length} include a checked bag`);
