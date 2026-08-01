/** Drive the Action Autopilot state machine against REAL Duffel inventory. */
import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const { buildActionGraph } = await import("../../lib/agents/crews/action-autopilot/graph.ts");
const { Command } = await import("@langchain/langgraph");

const graph = buildActionGraph();                    // MemorySaver for this probe
const config = { configurable: { thread_id: "probe-1" } };

const input = {
  tripId: "probe",
  disruption: { origin: "flight", delayMinutes: 95,
                headline: "Flight EK582 is 95 min late; connection at 97% risk" },
  search: { origin: "DXB", destination: "LHR", departureDate: "2026-08-05" }
};

console.log("── running to the approval gate ──\n");
let state = await graph.invoke(input, config);

const snap = await graph.getState(config);
console.log((state.log ?? []).map((l: string) => "  " + l).join("\n"));

console.log("\n── OPTIONS PRESENTED (real offers, different axes) ──");
for (const c of state.candidates ?? []) {
  const d = `${Math.floor(c.durationMinutes / 60)}h${String(c.durationMinutes % 60).padStart(2, "0")}`;
  console.log(`  ${c.title.padEnd(14)} ${c.carrier.slice(0, 18).padEnd(20)} ` +
    `${String(c.amount).padStart(7)} ${c.currency}  ${d}  ${c.segments}seg  ` +
    `bag:${c.includedCheckedBags}  ${c.holdable ? "holdable" : "NO HOLD"}`);
  console.log(`                 └ ${c.because}`);
}

console.log(`\n── PAUSED AT: ${snap.next.join(", ") || "(end)"} ──`);
const intr = (snap.tasks?.[0] as any)?.interrupts?.[0]?.value;
if (intr) {
  console.log(`  question    : ${intr.question}`);
  console.log(`  irreversible: ${intr.irreversible}`);
  console.log(`  rollback by : ${intr.rollbackDeadline}`);
  console.log(`  hold        : ${intr.hold ? intr.hold.bookingReference : "none"}`);
}

console.log("\n── resuming with REJECT (nothing should be paid) ──");
state = await graph.invoke(new Command({ resume: { decision: "reject" } }), config);
console.log((state.log ?? []).slice(-3).map((l: string) => "  " + l).join("\n"));
console.log(`  verified: ${JSON.stringify(state.verified)}`);
