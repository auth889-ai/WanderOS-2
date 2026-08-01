import { readFileSync } from "fs";
for (const l of readFileSync(".env.local","utf8").split("\n")) {
  const m=l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]]=m[2].trim().replace(/^["']|["']$/g,"");
}
const H = { Authorization:`Bearer ${process.env.DUFFEL_ACCESS_TOKEN}`, "Duffel-Version":"v2",
            Accept:"application/json","Content-Type":"application/json" };
const r = await fetch("https://api.duffel.com/air/offer_requests?return_offers=true",{
  method:"POST", headers:H, body: JSON.stringify({data:{
    slices:[{origin:"DXB",destination:"LHR",departure_date:"2026-08-04"}],
    passengers:[{type:"adult"}], cabin_class:"economy"}})});
const d = await r.json();
const offers = d.data.offers.slice(0,6);
console.log("  carrier            requires_instant  payment_types");
for (const o of offers) {
  const pr = o.payment_requirements ?? {};
  console.log(`  ${o.owner.name.slice(0,18).padEnd(20)} ${String(pr.requires_instant_payment).padEnd(17)} ${JSON.stringify(o.available_services ? "svc" : "")} pay_by=${pr.payment_required_by ?? "-"}`);
}
// Try a hold on the first one and print the exact error
const o = offers[0];
const hold = await fetch("https://api.duffel.com/air/orders",{ method:"POST", headers:H,
  body: JSON.stringify({data:{ type:"hold", selected_offers:[o.id],
    passengers:[{ id:o.passengers[0].id, title:"mr", gender:"m",
      given_name:"Test", family_name:"Traveller", born_on:"1990-01-01",
      email:"t@example.com", phone_number:"+442080160509" }]}})});
console.log(`\n  hold on ${o.owner.name}: HTTP ${hold.status}`);
console.log("  " + (await hold.text()).slice(0, 320));
