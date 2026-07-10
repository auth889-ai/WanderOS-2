/**
 * Agent test — pricing-analyst (host-studio crew) — action-taking with INTERNAL + EXTERNAL tools.
 *   Run: npm run test:agent:pricing
 * Part A: directly exercise the external tools (Google Maps, Ticketmaster/Calendarific) — graceful.
 * Part B: seed only other-category comps so the agent must broaden, and assert it grounds the price
 *         in comps AND fills location/demand factors from its external tools.
 */
import { readFileSync } from "fs";

for (const line of readFileSync(new URL("../../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("//") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { queryAurora } = await import("../../../lib/db/pool");
const { pricingAnalyst } = await import("../../../lib/agents/crews/host-studio/agents/pricing-analyst/agent");
const { locationIntelTool, seasonalDemandTool } = await import(
  "../../../lib/agents/crews/host-studio/agents/pricing-analyst/external-tools"
);

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── agent: pricing-analyst (internal + EXTERNAL tools) ──\n");

const CITY = "Paris";
const COUNTRY = "France";

// Part A — external tools directly (real APIs, graceful on failure)
const locRaw = await locationIntelTool.invoke({ city: CITY });
const loc = JSON.parse(String(locRaw));
console.log("locationIntel(Paris):", locRaw);
typeof loc.available === "boolean" ? ok("locationIntel returned (no throw — graceful)") : no("locationIntel malformed");
if (loc.available) ok(`locationIntel got REAL Maps data (${loc.nearbyAttractions} attractions)`);
else console.log(`   ⚠️  locationIntel unavailable (${loc.reason}) — agent will degrade gracefully`);

const seaRaw = await seasonalDemandTool.invoke({ city: CITY, country: COUNTRY });
console.log("seasonalDemand(Paris):", seaRaw, "\n");
typeof JSON.parse(String(seaRaw)).available === "boolean" ? ok("seasonalDemand returned (no throw — graceful)") : no("seasonalDemand malformed");

// Part B — the agent, with internal comps it must broaden to find
const host = (await queryAurora<{ id: string }>("select id from users where role='host' limit 1"))[0];
if (!host) throw new Error("seed a host first: npm run seed:demo");
for (const [title, price] of [["VillaA", 220], ["VillaB", 260], ["VillaC", 300]] as const) {
  await queryAurora(
    `insert into listings (host_id,title,description,city,country,category,price,status,moderation_status,quality_score)
     values ($1,$2,'seed',$3,$4,'villa',$5,'published','approved',82)`,
    [host.id, `PRICETEST ${title}`, CITY, COUNTRY, price]
  );
}

try {
  const pricing = await pricingAnalyst({
    city: CITY,
    country: COUNTRY,
    category: "apartment", // no apartment comps → must broaden
    qualityScore: 80,
    amenities: ["wifi", "kitchen"]
  });

  console.log("Pricing:", JSON.stringify(pricing, null, 2), "\n");

  typeof pricing.suggested === "number" && pricing.suggested > 0 ? ok("produced a numeric price") : no(`suggested=${pricing.suggested}`);
  pricing.min <= pricing.suggested && pricing.suggested <= pricing.max ? ok("price within its range") : no("price outside range");
  pricing.comparableIds.length > 0 ? ok("cited comps → broadened (internal action)") : no("no comps cited");
  pricing.locationFactor.length > 0 ? ok("set a locationFactor (used locationIntel)") : no("locationFactor empty");
  pricing.demandFactor.length > 0 ? ok("set a demandFactor (used seasonalDemand)") : no("demandFactor empty");
  ["none", "thin", "adequate", "strong"].includes(pricing.dataQuality) ? ok("dataQuality valid") : no(`dataQuality=${pricing.dataQuality}`);
  pricing.confidence >= 0 && pricing.confidence <= 1 ? ok("confidence in 0-1") : no(`confidence=${pricing.confidence}`);
} finally {
  await queryAurora("delete from listings where title like 'PRICETEST %'");
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
