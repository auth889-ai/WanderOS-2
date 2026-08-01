/** Async Textract via S3 staging, with the B2 original untouched. */
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const L = await import("../../lib/travel/extract/large-attachment.ts");

console.log("── the constraint, verified ──");
console.log(`  Q: ${L.TEXTRACT_SOURCE_CONSTRAINT.question}`);
console.log(`  A: ${L.TEXTRACT_SOURCE_CONSTRAINT.answer} ${L.TEXTRACT_SOURCE_CONSTRAINT.because.slice(0,150)}`);
console.log(`\n  ceilings: ${(L.ASYNC_MAX_BYTES/1048576).toFixed(0)} MB / ${L.ASYNC_MAX_PAGES} pages`);

// A multi-page PDF — the case the sync API cannot handle at all
writeFileSync("/tmp/mkpdf.py", `
from PIL import Image, ImageDraw, ImageFont
def F(s,b=False):
    try: return ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial%s.ttf"%(" Bold" if b else ""),s)
    except: return ImageFont.load_default()
pages=[]
content=[
 [("ITINERARY - page 1 of 3",True),("Passenger: RAHMAN / EVA",False),
  ("Booking reference: 8891245",False),("Issued 1 August 2026",False)],
 [("FLIGHT DETAILS - page 2 of 3",True),("Flight EK582  Dubai (DXB) to London (LHR)",False),
  ("Departs: 4 August 2026 18:35",False),("Arrives: 4 August 2026 21:10",False),
  ("Checked baggage: 1 x 23kg",False)],
 [("HOTEL - page 3 of 3",True),("Hotel Ocean View, Kensington",False),
  ("Check-in: 4 August 2026 from 15:00",False),
  ("Reception closes at 23:00",True),("Total: GBP 612.45  Non-refundable",True)],
]
for c in content:
    img=Image.new("RGB",(1000,700),"white"); d=ImageDraw.Draw(img); y=70
    for t,b in c: d.text((50,y),t,font=F(22,b),fill="#111"); y+=52
    pages.append(img)
pages[0].save("/tmp/itinerary.pdf", save_all=True, append_images=pages[1:])
`);
execSync("cd media-worker && .venv/bin/python /tmp/mkpdf.py", { stdio: "ignore" });
const bytes = new Uint8Array(readFileSync("/tmp/itinerary.pdf"));
console.log(`\n── 3-page PDF, ${(bytes.byteLength/1024).toFixed(0)} KB ──`);
console.log("  (the SYNC api handles only 1 PDF page — this needs async)");

const r = await L.readLargeAttachment(bytes, "application/pdf",
  "b2://wanderos-media/inbound/8891245/itinerary.pdf");
if (!r.ok) { console.log(`  FAILED: ${r.reason}`); process.exit(1); }
console.log(`  job ${r.jobId.slice(0,16)}...  ${r.pages} pages, ${r.lines.length} lines, ${r.pairs.length} pairs`);
console.log(`  evidence still points at B2: ${r.evidenceRef}`);
console.log("\n  pairs found across all pages:");
for (const p of r.pairs.filter(p => p.value.trim()).slice(0,8))
  console.log(`    p${p.page}  ${p.key.slice(0,24).padEnd(26)} = ${p.value.slice(0,36)}`);
