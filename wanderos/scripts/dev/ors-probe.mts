import { readFileSync } from "fs";
for (const l of readFileSync(".env.local","utf8").split("\n")) {
  const m=l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]]=m[2].trim().replace(/^["']|["']$/g,"");
}
const A = await import("../../lib/travel/accessibility.ts");
const r = await A.stepFreeRoute({ from: [-0.1755, 51.5154], to: [-0.1898, 51.4975] });
console.log(r.ok ? `  Paddington -> Kensington: ${r.distanceMetres}m, ${r.durationMinutes}min, max incline ${r.maxInclinePercent}%`
                 : `  FAILED noRoute=${r.noRouteExists} ${r.reason.slice(0,120)}`);
