/**
 * E2E (HTTP) - traveler trip planner API over real HTTP.
 *   Run: npm run test:e2e:trips
 *
 * Proves the route layer for the AI Trip Planner foundation:
 * auth/RBAC, POST /api/trips, GET /api/trips/[id], regenerate/refine, and SSE stream ownership.
 */
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { spawn, ChildProcess } from "child_process";

for (const line of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("#") || line.trim().startsWith("//")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { queryAurora } = await import("../../lib/db/pool");
const { createSessionToken, sessionCookieName } = await import("../../lib/auth/token");
const { closeQueues, removeQueuedJob } = await import("../../lib/queue/queues");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

const BASE = "http://localhost:5050";
console.log("\n── E2E (HTTP): traveler trip planner API ──\n");

const [traveler] = await queryAurora<{ id: string; email: string }>(
  `insert into users (name, email, role) values ('Trip HTTP Traveler', $1, 'traveler') returning id, email`,
  [`trip-http-${randomUUID()}@test.local`]
);
const [otherTraveler] = await queryAurora<{ id: string; email: string }>(
  `insert into users (name, email, role) values ('Trip HTTP Other', $1, 'traveler') returning id, email`,
  [`trip-http-other-${randomUUID()}@test.local`]
);
const [host] = await queryAurora<{ id: string; email: string }>(
  `insert into users (name, email, role) values ('Trip HTTP Host', $1, 'host') returning id, email`,
  [`trip-http-host-${randomUUID()}@test.local`]
);

const travelerCookie = `${sessionCookieName}=${createSessionToken({
  id: traveler.id,
  name: "Trip HTTP Traveler",
  email: traveler.email,
  role: "traveler"
})}`;
const otherCookie = `${sessionCookieName}=${createSessionToken({
  id: otherTraveler.id,
  name: "Trip HTTP Other",
  email: otherTraveler.email,
  role: "traveler"
})}`;
const hostCookie = `${sessionCookieName}=${createSessionToken({
  id: host.id,
  name: "Trip HTTP Host",
  email: host.email,
  role: "host"
})}`;
const staleCookie = `${sessionCookieName}=${createSessionToken({
  id: "not-a-real-user-id",
  name: "Deleted Traveler",
  email: "deleted-traveler@test.local",
  role: "traveler"
})}`;

const H = (cookie?: string) => ({ "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) });

let server: ChildProcess | null = null;
let tripId = "";
let jobId = "";
const jobIds: string[] = [];
let queueUnavailable = false;

async function waitForServer(timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/auth/me`, { headers: H() });
      if (r.status > 0) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

async function firstSseChunk(url: string, cookie: string) {
  const controller = new AbortController();
  const response = await fetch(url, { headers: { Cookie: cookie }, signal: controller.signal });
  const reader = response.body?.getReader();
  let text = "";
  if (reader) {
    const first = await reader.read();
    text = first.value ? new TextDecoder().decode(first.value) : "";
    await reader.cancel().catch(() => {});
  }
  controller.abort();
  return { response, text };
}

try {
  console.log("booting next dev (port 5050)...");
  server = spawn("npm run dev", { cwd: new URL("../../", import.meta.url).pathname, shell: true, detached: true, stdio: "ignore" });
  const up = await waitForServer();
  up ? ok("dev server is up") : no("dev server did not start in time");
  if (!up) throw new Error("server boot failed");

  const unauthCreate = await fetch(`${BASE}/api/trips`, {
    method: "POST",
    headers: H(),
    body: JSON.stringify({ destination: "Tokyo" })
  });
  unauthCreate.status === 401 ? ok("POST without session -> 401") : no(`unauth POST status=${unauthCreate.status}`);

  const staleCreate = await fetch(`${BASE}/api/trips`, {
    method: "POST",
    headers: H(staleCookie),
    body: JSON.stringify({ destination: "Tokyo" })
  });
  staleCreate.status === 401 ? ok("POST with stale/invalid session -> 401") : no(`stale POST status=${staleCreate.status}`);

  const hostCreate = await fetch(`${BASE}/api/trips`, {
    method: "POST",
    headers: H(hostCookie),
    body: JSON.stringify({ destination: "Tokyo" })
  });
  hostCreate.status === 403 ? ok("POST as host -> 403") : no(`host POST status=${hostCreate.status}`);

  const badCreate = await fetch(`${BASE}/api/trips`, {
    method: "POST",
    headers: H(travelerCookie),
    body: JSON.stringify({ destination: "" })
  });
  badCreate.status === 400 ? ok("POST invalid body -> 400") : no(`invalid POST status=${badCreate.status}`);

  const create = await fetch(`${BASE}/api/trips`, {
    method: "POST",
    headers: H(travelerCookie),
    body: JSON.stringify({
      title: "HTTP Tokyo Food Plan",
      destination: "Tokyo",
      startDate: "2026-07-10",
      endDate: "2026-07-13",
      budget: 1800,
      travelStyle: "food-culture",
      interests: ["ramen", "museums"],
      party: "couple",
      pace: "balanced",
      constraints: { dietary: "no shellfish" }
    })
  });
  const created = await create.json();
  tripId = created.tripId;
  jobId = created.jobId;
  if (jobId) jobIds.push(jobId);

  queueUnavailable = create.status === 503 && created.error === "planner_queue_unavailable";
  if (queueUnavailable) {
    tripId ? ok(`POST create -> 503 queue unavailable JSON (${tripId.slice(0, 8)})`) : no(`create 503 missing tripId body=${JSON.stringify(created)}`);
    created.status === "failed" ? ok("created trip status is failed when queue is unavailable") : no(`status=${created.status}`);
  } else {
    create.status === 202 && tripId ? ok(`POST create -> 202 (${tripId.slice(0, 8)})`) : no(`create status=${create.status} body=${JSON.stringify(created)}`);
    created.status === "planning" ? ok("created trip status is planning") : no(`status=${created.status}`);
    created.jobId ? ok("created response includes trip_plan jobId") : no(`jobId=${created.jobId}`);
  }

  const read = await fetch(`${BASE}/api/trips/${tripId}`, { headers: H(travelerCookie) });
  const readBody = await read.json();
  read.status === 200 ? ok("GET own trip -> 200") : no(`GET own status=${read.status}`);
  readBody.trip?.id === tripId ? ok("GET returns trip") : no("GET trip id mismatch");
  readBody.trip?.status === (queueUnavailable ? "failed" : "planning")
    ? ok(`GET returns ${queueUnavailable ? "failed" : "planning"} status`)
    : no(`GET status=${readBody.trip?.status}`);
  readBody.activePlan === null ? ok("GET activePlan is null before worker version") : no("activePlan should be null");

  const deniedRead = await fetch(`${BASE}/api/trips/${tripId}`, { headers: H(otherCookie) });
  deniedRead.status === 404 ? ok("GET as another traveler -> 404") : no(`other traveler GET status=${deniedRead.status}`);

  const unauthRead = await fetch(`${BASE}/api/trips/${tripId}`, { headers: H() });
  unauthRead.status === 401 ? ok("GET without session -> 401") : no(`unauth GET status=${unauthRead.status}`);

  const tripsPage = await fetch(`${BASE}/trips`, { headers: { Cookie: travelerCookie } });
  tripsPage.status === 200 ? ok("/trips page renders for traveler") : no(`/trips status=${tripsPage.status}`);

  const newTripPage = await fetch(`${BASE}/trips/new`, { headers: { Cookie: travelerCookie } });
  newTripPage.status === 200 ? ok("/trips/new page renders for traveler") : no(`/trips/new status=${newTripPage.status}`);

  const tripDetailPage = await fetch(`${BASE}/trips/${tripId}`, { headers: { Cookie: travelerCookie } });
  tripDetailPage.status === 200 ? ok("/trips/[id] page renders for owner") : no(`/trips/[id] status=${tripDetailPage.status}`);

  const deniedTripDetailPage = await fetch(`${BASE}/trips/${tripId}`, { headers: { Cookie: otherCookie } });
  const deniedTripDetailText = await deniedTripDetailPage.text();
  !deniedTripDetailText.includes("HTTP Tokyo Food Plan")
    ? ok("/trips/[id] page does not expose owner trip content to another traveler")
    : no(`other trip page exposed content, status=${deniedTripDetailPage.status}`);

  const hostRegen = await fetch(`${BASE}/api/trips/${tripId}/regenerate`, {
    method: "POST",
    headers: H(hostCookie),
    body: JSON.stringify({ hint: "make it slower" })
  });
  hostRegen.status === 403 ? ok("regenerate as host -> 403") : no(`host regenerate status=${hostRegen.status}`);

  const otherRegen = await fetch(`${BASE}/api/trips/${tripId}/regenerate`, {
    method: "POST",
    headers: H(otherCookie),
    body: JSON.stringify({ hint: "make it slower" })
  });
  otherRegen.status === 404 ? ok("regenerate as another traveler -> 404") : no(`other regenerate status=${otherRegen.status}`);

  const regen = await fetch(`${BASE}/api/trips/${tripId}/regenerate`, {
    method: "POST",
    headers: H(travelerCookie),
    body: JSON.stringify({ hint: "slower mornings and fewer paid activities" })
  });
  const regenBody = await regen.json();
  if (regenBody.jobId) jobIds.push(regenBody.jobId);
  if (queueUnavailable) {
    regen.status === 503 && regenBody.error === "planner_queue_unavailable"
      ? ok("regenerate own trip -> 503 queue unavailable JSON")
      : no(`regen status=${regen.status} body=${JSON.stringify(regenBody)}`);
  } else {
    regen.status === 202 && regenBody.jobId ? ok("regenerate own trip -> 202 + job") : no(`regen status=${regen.status} body=${JSON.stringify(regenBody)}`);
  }

  const invalidRefine = await fetch(`${BASE}/api/trips/${tripId}/refine`, {
    method: "POST",
    headers: H(travelerCookie),
    body: JSON.stringify({ instruction: "" })
  });
  invalidRefine.status === 400 ? ok("refine invalid body -> 400") : no(`invalid refine status=${invalidRefine.status}`);

  const otherRefine = await fetch(`${BASE}/api/trips/${tripId}/refine`, {
    method: "POST",
    headers: H(otherCookie),
    body: JSON.stringify({ instruction: "add more food stops" })
  });
  otherRefine.status === 404 ? ok("refine as another traveler -> 404") : no(`other refine status=${otherRefine.status}`);

  const refine = await fetch(`${BASE}/api/trips/${tripId}/refine`, {
    method: "POST",
    headers: H(travelerCookie),
    body: JSON.stringify({ instruction: "make it cheaper but keep museums" })
  });
  const refineBody = await refine.json();
  if (refineBody.jobId) jobIds.push(refineBody.jobId);
  if (queueUnavailable) {
    refine.status === 503 && refineBody.error === "planner_queue_unavailable"
      ? ok("refine own trip -> 503 queue unavailable JSON")
      : no(`refine status=${refine.status} body=${JSON.stringify(refineBody)}`);
  } else {
    refine.status === 202 && refineBody.jobId ? ok("refine own trip -> 202 + job") : no(`refine status=${refine.status} body=${JSON.stringify(refineBody)}`);
  }

  const otherStream = await fetch(`${BASE}/api/trips/${tripId}/stream`, { headers: { Cookie: otherCookie } });
  otherStream.status === 404 ? ok("stream as another traveler -> 404") : no(`other stream status=${otherStream.status}`);

  const unauthStream = await fetch(`${BASE}/api/trips/${tripId}/stream`);
  unauthStream.status === 401 ? ok("stream without session -> 401") : no(`unauth stream status=${unauthStream.status}`);

  const ownStream = await firstSseChunk(`${BASE}/api/trips/${tripId}/stream`, travelerCookie);
  ownStream.response.status === 200 ? ok("stream own trip -> 200") : no(`own stream status=${ownStream.response.status}`);
  ownStream.response.headers.get("content-type")?.includes("text/event-stream")
    ? ok("stream content-type is SSE")
    : no(`stream content-type=${ownStream.response.headers.get("content-type")}`);
  ownStream.text.includes("trip_plan") || ownStream.text.includes("jobs")
    ? ok("stream emits trip job payload")
    : no(`stream first chunk=${ownStream.text}`);

  const [version] = await queryAurora<{ id: string }>(
    `insert into trip_plan_versions (trip_id, version, status, generation_mode, input_snapshot, planning_context, ai_summary, verifier_report, total_estimate, created_by)
     values ($1, 1, 'active', 'ai', '{}', '{}', 'HTTP test plan', '{}', 120, $2)
     returning id`,
    [tripId, traveler.id]
  );
  await queryAurora(
    `insert into itinerary_days (trip_id, plan_version_id, day_number, date, theme, summary, area)
     values ($1, $2, 1, '2026-07-10', 'Test day', 'Owner editable test day.', 'Shinjuku')`,
    [tripId, version.id]
  );
  const [seedItem] = await queryAurora<{ id: string }>(
    `insert into itinerary_items (trip_id, plan_version_id, day_number, time_label, title, description, category, source, est_cost, cost_source, cost_rationale)
     values ($1, $2, 1, 'Morning', 'Seed editable item', 'Seed item for owner CRUD.', 'test', 'test', 12, 'test_source', 'Test cost evidence.')
     returning id`,
    [tripId, version.id]
  );

  const addItem = await fetch(`${BASE}/api/trips/${tripId}/items`, {
    method: "POST",
    headers: H(travelerCookie),
    body: JSON.stringify({
      dayNumber: 1,
      timeLabel: "Lunch",
      title: "Owner added lunch",
      description: "Traveler-owned manual addition.",
      category: "food",
      estCost: 24
    })
  });
  const addBody = await addItem.json();
  addItem.status === 201 && addBody.item?.id ? ok("POST add itinerary item as owner -> 201") : no(`add item status=${addItem.status} body=${JSON.stringify(addBody)}`);

  const otherAdd = await fetch(`${BASE}/api/trips/${tripId}/items`, {
    method: "POST",
    headers: H(otherCookie),
    body: JSON.stringify({ dayNumber: 1, title: "Intruding item" })
  });
  otherAdd.status === 404 ? ok("POST add item as another traveler -> 404") : no(`other add status=${otherAdd.status}`);

  const patchItem = await fetch(`${BASE}/api/trips/${tripId}/items/${seedItem.id}`, {
    method: "PATCH",
    headers: H(travelerCookie),
    body: JSON.stringify({ title: "Updated editable item", locked: true, estCost: 18 })
  });
  const patchBody = await patchItem.json();
  patchItem.status === 200 && patchBody.item?.locked === true ? ok("PATCH item as owner -> 200 + locked") : no(`patch status=${patchItem.status} body=${JSON.stringify(patchBody)}`);

  const otherPatch = await fetch(`${BASE}/api/trips/${tripId}/items/${seedItem.id}`, {
    method: "PATCH",
    headers: H(otherCookie),
    body: JSON.stringify({ title: "Not mine" })
  });
  otherPatch.status === 404 ? ok("PATCH item as another traveler -> 404") : no(`other patch status=${otherPatch.status}`);

  const badPatch = await fetch(`${BASE}/api/trips/${tripId}/items/${seedItem.id}`, {
    method: "PATCH",
    headers: H(travelerCookie),
    body: JSON.stringify({ title: "" })
  });
  badPatch.status === 400 ? ok("PATCH invalid item body -> 400") : no(`bad patch status=${badPatch.status}`);

  const otherDelete = await fetch(`${BASE}/api/trips/${tripId}/items/${seedItem.id}`, {
    method: "DELETE",
    headers: H(otherCookie)
  });
  otherDelete.status === 404 ? ok("DELETE item as another traveler -> 404") : no(`other delete status=${otherDelete.status}`);

  const deleteAdded = await fetch(`${BASE}/api/trips/${tripId}/items/${addBody.item?.id}`, {
    method: "DELETE",
    headers: H(travelerCookie)
  });
  deleteAdded.status === 200 ? ok("DELETE item as owner -> 200") : no(`delete status=${deleteAdded.status}`);
} finally {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
  if (tripId && !queueUnavailable) {
    const keys = await queryAurora<{ idempotency_key: string }>(
      `select idempotency_key from agent_jobs where type = 'trip_plan' and input->>'tripId' = $1`,
      [tripId]
    ).catch(() => []);
    for (const key of keys) {
      await removeQueuedJob("trip_plan", key.idempotency_key).catch(() => {});
    }
  }
  if (!queueUnavailable) await closeQueues().catch(() => {});
  if (jobIds.length) await queryAurora(`delete from agent_jobs where id = any($1::uuid[])`, [jobIds]).catch(() => {});
  if (tripId) await queryAurora(`delete from agent_jobs where type = 'trip_plan' and input->>'tripId' = $1`, [tripId]).catch(() => {});
  if (tripId) await queryAurora(`delete from trips where id = $1`, [tripId]).catch(() => {});
  await queryAurora(`delete from users where id = any($1::uuid[])`, [[traveler.id, otherTraveler.id, host.id]]).catch(() => {});
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
