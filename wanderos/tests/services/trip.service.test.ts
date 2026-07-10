/**
 * Service test - trip.service (start planner trip + read active plan shell).
 *   Run: npm run test:svc:trip
 */
import { readFileSync } from "fs";
import { randomUUID } from "crypto";

for (const line of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("//") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { queryAurora } = await import("../../lib/db/pool");
const { getJob } = await import("../../lib/db/tables/agent-jobs");
const { removeQueuedJob, closeQueues } = await import("../../lib/queue/queues");
const svc = await import("../../lib/services/trip.service");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

console.log("\n── service: trip.service ──\n");

const [traveler] = await queryAurora<{ id: string }>(
  `insert into users (name, email, role) values ('Trip Service Traveler', $1, 'traveler') returning id`,
  [`trip-svc-${randomUUID()}@test.local`]
);

let tripId = "";
let jobId = "";

try {
  const started = await svc.startPlan(traveler.id, {
    title: "TripSvc Tokyo Food Plan",
    destination: "Tokyo",
    startDate: "2026-07-10",
    endDate: "2026-07-13",
    budget: 1800,
    travelStyle: "food-culture",
    interests: ["ramen", "museums", "night walks"],
    party: "couple",
    pace: "balanced",
    constraints: { dietary: "no shellfish" }
  });

  tripId = started.trip.id;
  jobId = started.jobId;

  started.jobId ? ok("startPlan returns real trip_plan jobId") : no(`jobId=${started.jobId}`);
  started.trip.status === "planning" ? ok("startPlan marks trip planning") : no(`status=${started.trip.status}`);
  started.trip.destination === "Tokyo" ? ok("destination persisted") : no(`destination=${started.trip.destination}`);

  const job = await getJob(jobId);
  job?.type === "trip_plan" ? ok("agent_jobs row type is trip_plan") : no(`job type=${job?.type}`);
  job?.status === "queued" ? ok("trip_plan job is queued") : no(`job status=${job?.status}`);
  (job?.input as { tripId?: string })?.tripId === tripId ? ok("job input carries tripId") : no("job input missing tripId");

  const [dbTrip] = await queryAurora<{
    status: string;
    profile: {
      party?: string;
      pace?: string;
      interests?: string[];
      constraints?: Record<string, unknown>;
    };
  }>(`select status, profile from trips where id = $1`, [tripId]);

  dbTrip?.status === "planning" ? ok("Aurora row status is planning") : no(`db status=${dbTrip?.status}`);
  dbTrip?.profile?.party === "couple" ? ok("profile.party stored in Aurora") : no(`party=${dbTrip?.profile?.party}`);
  dbTrip?.profile?.pace === "balanced" ? ok("profile.pace stored in Aurora") : no(`pace=${dbTrip?.profile?.pace}`);
  dbTrip?.profile?.interests?.includes("ramen") ? ok("profile.interests stored in Aurora") : no("interests missing");
  dbTrip?.profile?.constraints?.dietary === "no shellfish" ? ok("profile.constraints stored in Aurora") : no("constraints missing");

  const read = await svc.getTrip(traveler.id, tripId);
  read?.trip.id === tripId ? ok("getTrip returns the created trip") : no("getTrip did not return trip");
  read?.activePlan === null ? ok("getTrip activePlan is null before worker creates a version") : no("activePlan should be null");
} finally {
  if (tripId) await removeQueuedJob("trip_plan", `trip-plan-${tripId}`).catch(() => {});
  await closeQueues().catch(() => {});
  if (jobId) await queryAurora(`delete from agent_jobs where id = $1`, [jobId]).catch(() => {});
  if (tripId) await queryAurora(`delete from trips where id = $1`, [tripId]);
  await queryAurora(`delete from users where id = $1`, [traveler.id]);
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
