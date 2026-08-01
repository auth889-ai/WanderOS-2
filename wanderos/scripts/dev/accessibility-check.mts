/** Probe the Accessibility Reality Layer against live ORS + OSM. */
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const A = await import("../../lib/travel/accessibility.ts");

console.log("── RULE 1: Unknown ≠ Accessible ──");
for (const tags of [{ wheelchair: "yes" }, { wheelchair: "limited" },
                    { wheelchair: "no" }, { amenity: "cafe" }]) {
  const f = A.readOsmAccess(tags);
  console.log(`  ${JSON.stringify(tags).slice(0,26).padEnd(28)} -> ${f.level.padEnd(8)} basis=${f.basis}`);
}

console.log("\n── RULE 3: Old report ≠ Current reality ──");
const now = Date.now();
for (const [days, kind] of [[7,"lift"],[60,"lift"],[400,"lift"],[7,"entrance"],[400,"entrance"]] as [number,string][]) {
  const d = A.decayConfidence(new Date(now - days*86400000).toISOString(), kind);
  console.log(`  ${String(days).padStart(4)}d old ${kind.padEnd(9)} confidence ${d.confidence.toFixed(2)}  ${d.stale ? "STALE" : "ok"}`);
}

console.log("\n── REAL step-free route: Westminster → Trafalgar Square ──");
const r = await A.stepFreeRoute({ from: [-0.1276, 51.5072], to: [-0.1281, 51.5080] });
if (r.ok) {
  console.log(`  ${r.distanceMetres}m, ${r.durationMinutes}min, max incline ${r.maxInclinePercent ?? "n/a"}%`);
  console.log(`  basis: ${r.basis}`);
  console.log(`  caveat: ${r.caveat.slice(0,88)}`);
  if (r.warnings.length) console.log(`  warnings: ${r.warnings.join("; ")}`);
} else {
  console.log(`  FAILED: ${r.reason} (no route exists: ${r.noRouteExists})`);
}

console.log("\n── the penalty a wheelchair user pays ──");
const p = await A.accessibilityPenalty([-0.1276, 51.5072], [-0.1195, 51.5033]);
console.log(`  walking ${p.walking}m  step-free ${p.stepFree}m  extra ${p.extraMetres}m`);
console.log(`  ${p.note}`);

console.log("\n── REAL wheelchair-tagged places near Westminster ──");
const places = await A.accessiblePlacesNear(51.5072, -0.1276, 400);
for (const pl of places.places.slice(0, 6)) {
  console.log(`  ${pl.access.level.padEnd(8)} ${pl.name.slice(0,30).padEnd(32)} ${pl.kind}`);
}
console.log(`  ${places.note}`);
