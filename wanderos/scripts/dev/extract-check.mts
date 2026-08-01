/** Deterministic tiers against realistic confirmation payloads. */
const E = await import("../../lib/travel/extract/structured.ts");

// A real-shape Gmail-markup confirmation. Airlines embed exactly this.
const email = `<html><head>
<script type="application/ld+json">
{"@context":"http://schema.org","@type":"FlightReservation",
 "reservationNumber":"ABC123","underName":{"@type":"Person","name":"Eva Rahman"},
 "reservationFor":{"@type":"Flight","flightNumber":"582",
   "airline":{"@type":"Airline","name":"Emirates","iataCode":"EK"},
   "departureAirport":{"@type":"Airport","iataCode":"DXB"},
   "arrivalAirport":{"@type":"Airport","iataCode":"LHR"},
   "departureTime":"2026-08-04T18:35:00+04:00",
   "arrivalTime":"2026-08-04T21:10:00+01:00"},
 "reservedTicket":{"@type":"Ticket","ticketedSeat":{"@type":"Seat","seatNumber":"14A"}}}
</script></head><body>Your booking is confirmed.</body></html>`;

console.log("── TIER 1: schema.org JSON-LD (no model involved) ──");
const j = E.extractJsonLd(email);
for (const s of j) {
  console.log(`  ${s.carrier} ${s.number}  ${s.from}→${s.to}`);
  console.log(`  ref ${s.reference}  seat ${s.seat}  passenger ${s.passenger}`);
  console.log(`  departs ${s.departsAt}   tz-known: ${!s.timezoneUnknown}`);
  console.log(`  tier=${s.tier} confidence=${s.confidence}`);
}

console.log("\n── timezone discipline ──");
for (const t of ["2026-08-04T18:35:00+04:00","2026-08-04T18:35:00Z","2026-08-04T18:35:00"]) {
  console.log(`  ${t.padEnd(28)} zone-qualified: ${E.hasTimezone(t)}`);
}

console.log("\n── TIER 2: IATA BCBP boarding pass barcode ──");
const bcbp = "M1RAHMAN/EVA          EABC123 DXBLHREK 0582 216Y014A0050 100";
const b = E.extractBoardingPass(bcbp, new Date("2026-08-01T00:00:00Z"));
if (b) {
  console.log(`  ${b.carrier}${b.number.replace(b.carrier ?? "","")}  ${b.from}→${b.to}`);
  console.log(`  ref ${b.reference}  seat ${b.seat}  passenger ${b.passenger}`);
  console.log(`  date ${b.departsAt} (julian 216 resolved)  tier=${b.tier}`);
} else console.log("  no match");

console.log("\n── MERGE: gaps filled, not overwritten ──");
const merged = E.mergeSegments(j, b ? [b] : []);
for (const m of merged) {
  console.log(`  ${m.carrier} ${m.number} ${m.from}→${m.to}`);
  console.log(`  arrival from JSON-LD: ${m.arrivesAt}`);
  console.log(`  seat: ${m.seat}   tz-known: ${!m.timezoneUnknown}`);
  console.log(`  ${merged.length} segment(s) — the two tiers recognised the same journey`);
}

console.log("\n── an email with NO structure falls through to later tiers ──");
console.log(`  plain text -> ${E.extractJsonLd("<p>Your flight is confirmed</p>").length} segments`);
