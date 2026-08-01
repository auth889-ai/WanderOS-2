/** Tier 3 against real Textract, including both failure paths. */
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const A = await import("../../lib/travel/extract/attachment.ts");

console.log("── documented limits ──");
console.log(`  Lambda Function URL request : ${(A.FUNCTION_URL_LIMIT_BYTES/1048576).toFixed(0)} MB`);
console.log(`  Textract sync document      : ${(A.TEXTRACT_SYNC_LIMIT_BYTES/1048576).toFixed(0)} MB`);
console.log(`  real attachment ceiling     : ${(A.MAX_ATTACHMENT_BYTES/1048576).toFixed(2)} MB (base64 inflates 4/3)`);

console.log("\n── FAILURE 1: oversized attachment ──");
const big = new Uint8Array(6 * 1024 * 1024);
const r1 = await A.readAttachment(big, "application/pdf", "b2://x");
if (!r1.ok) console.log(`  tooLarge=${r1.tooLarge} size=${(r1.sizeBytes!/1048576).toFixed(1)}MB\n  ${r1.reason.slice(0,110)}`);

console.log("\n── FAILURE 2: unsupported type ──");
const r2 = await A.readAttachment(new Uint8Array([1,2,3]), "application/zip", "b2://y");
if (!r2.ok) console.log(`  tooLarge=${r2.tooLarge}  ${r2.reason.slice(0,88)}`);

console.log("\n── SUCCESS: a real booking PDF through Textract ──");
// Render a realistic confirmation to PNG (Textract reads images and PDFs alike)
const py = `
from PIL import Image, ImageDraw, ImageFont
img=Image.new("RGB",(1000,620),"white"); d=ImageDraw.Draw(img)
def F(s,b=False):
    try: return ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial%s.ttf"%(" Bold" if b else ""),s)
    except: return ImageFont.load_default()
d.rectangle([0,0,1000,80],fill="#003580"); d.text((36,26),"Booking.com",font=F(30,True),fill="white")
y=115
for t,b in [("Your booking is confirmed",True),
 ("Confirmation number: 4738291055",False),("Hotel Ocean View",True),
 ("32 Ocean Drive, Kensington, London SW7 4RJ",False),
 ("Check-in: Tuesday 4 August 2026, from 15:00",False),
 ("Check-out: Tuesday 11 August 2026, until 11:00",False),
 ("Reception closes at 23:00 - no late check-in on this rate",True),
 ("Total price: GBP 612.45",True),
 ("Non-refundable. Cancellation is not permitted.",True)]:
    d.text((36,y),t,font=F(19,b),fill="#111"); y+=42
img.save("/tmp/booking.png")
`;
writeFileSync("/tmp/mk.py", py);
execSync("cd media-worker && .venv/bin/python /tmp/mk.py", { stdio: "ignore" });

const bytes = new Uint8Array(readFileSync("/tmp/booking.png"));
console.log(`  attachment: ${(bytes.byteLength/1024).toFixed(0)} KB PNG`);
const r3 = await A.readAttachment(bytes, "image/png", "b2://wanderos-media/inbound/abc.png");
if (!r3.ok) { console.log("  FAILED:", r3.reason); process.exit(1); }
console.log(`  ${r3.lines.length} lines, ${r3.pairs.length} key/value pairs, ${r3.pages} page(s)`);
for (const p of r3.pairs.slice(0,6))
  console.log(`    p${p.page} ${p.key.slice(0,24).padEnd(26)} = ${p.value.slice(0,34).padEnd(36)} conf ${p.confidence}`);

console.log("\n── segments WITH page + source evidence ──");
for (const s of A.segmentsFromAttachment(r3)) {
  console.log(`  kind=${s.kind} tier=${s.tier} confidence=${s.confidence} (weakest field, not average)`);
  console.log(`  departsAt=${s.departsAt}  reference=${s.reference}`);
  for (const e of s.evidence) console.log(`    ${e.field.padEnd(11)} <- p${e.page} "${e.text.slice(0,52)}"`);
}
