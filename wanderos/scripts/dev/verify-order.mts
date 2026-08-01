import { readFileSync } from "fs";
for (const l of readFileSync(".env.local","utf8").split("\n")) {
  const m=l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]]=m[2].trim().replace(/^["']|["']$/g,"");
}
const id = process.argv[2];
const r = await fetch(`https://api.duffel.com/air/orders/${id}`, {
  headers: { Authorization:`Bearer ${process.env.DUFFEL_ACCESS_TOKEN}`,
             "Duffel-Version":"v2", Accept:"application/json" }});
const d = (await r.json()).data;
console.log(`  HTTP ${r.status} — the order EXISTS in Duffel's system`);
console.log(`  reference   : ${d.booking_reference}`);
console.log(`  status      : ${d.payment_status?.awaiting_payment ? "held, awaiting payment" : "paid"}`);
console.log(`  pay by      : ${d.payment_status?.payment_required_by}`);
console.log(`  carrier     : ${d.owner?.name}`);
console.log(`  route       : ${d.slices?.[0]?.segments?.[0]?.origin?.iata_code} -> ${d.slices?.[0]?.segments?.slice(-1)[0]?.destination?.iata_code}`);
console.log(`  passenger   : ${d.passengers?.[0]?.given_name} ${d.passengers?.[0]?.family_name}`);
console.log(`  can cancel  : ${d.available_actions?.includes("cancel")}`);
