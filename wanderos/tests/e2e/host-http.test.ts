/**
 * E2E (HTTP) — the host listing API over REAL HTTP: boots the Next dev server, mints a host session
 * cookie, and drives create → cancel → list → edit → publish-guard → delete through the actual routes.
 *   Run: npm run test:e2e:http
 * Fast: it cancels the studio job right after create, so no crew runs (the full crew→row path is in
 * host-crew-e2e.test.ts). This proves the HTTP layer: auth/RBAC, Zod, routing, status codes.
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
const { closeQueues } = await import("../../lib/queue/queues");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

const BASE = "http://localhost:5050";
console.log("\n── E2E (HTTP): host listing API ──\n");

// real host + traveler users (uuid), so getSession's findUserById resolves them
const [host] = await queryAurora<{ id: string }>(
  `insert into users (name, email, role) values ('E2E Host', $1, 'host') returning id`,
  [`e2e-${randomUUID()}@test.local`]
);
const [traveler] = await queryAurora<{ id: string }>(
  `insert into users (name, email, role) values ('E2E Traveler', $1, 'traveler') returning id`,
  [`e2et-${randomUUID()}@test.local`]
);
const hostCookie = `${sessionCookieName}=${createSessionToken({ id: host.id, name: "E2E Host", email: "e2e@test.local", role: "host" })}`;
const travelerCookie = `${sessionCookieName}=${createSessionToken({ id: traveler.id, name: "E2E Trav", email: "t@test.local", role: "traveler" })}`;

const H = (cookie?: string) => ({ "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) });

let server: ChildProcess | null = null;
let listingId = "";

async function waitForServer(timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/auth/me`, { headers: H() });
      if (r.status > 0) return true; // any HTTP response = server is up
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

try {
  console.log("booting next dev (port 5050)…");
  server = spawn("npm run dev", { cwd: new URL("../../", import.meta.url).pathname, shell: true, detached: true, stdio: "ignore" });
  const up = await waitForServer();
  up ? ok("dev server is up") : no("dev server did not start in time");
  if (!up) throw new Error("server boot failed");

  // 1 — unauth → 401
  const unauth = await fetch(`${BASE}/api/host/listings`, { headers: H() });
  unauth.status === 401 ? ok("GET without session → 401") : no(`status=${unauth.status}`);

  // 2 — traveler → 403 (RBAC)
  const wrongRole = await fetch(`${BASE}/api/host/listings`, { headers: H(travelerCookie) });
  wrongRole.status === 403 ? ok("GET as traveler → 403 (RBAC)") : no(`status=${wrongRole.status}`);

  // 3 — create draft → 202
  const create = await fetch(`${BASE}/api/host/listings`, {
    method: "POST",
    headers: H(hostCookie),
    body: JSON.stringify({ city: "Dubai", country: "UAE", category: "apartment", notes: "modern", photos: [] })
  });
  const created = await create.json();
  listingId = created.listingId;
  create.status === 202 && listingId ? ok(`POST create → 202 (${listingId.slice(0, 8)})`) : no(`status=${create.status} body=${JSON.stringify(created)}`);

  // 4 — cancel the job so no crew runs
  const cancel = await fetch(`${BASE}/api/host/listings/${listingId}/cancel`, { method: "POST", headers: H(hostCookie) });
  cancel.status === 200 ? ok("POST cancel → 200") : no(`cancel status=${cancel.status}`);

  // 5 — invalid body → 400 (Zod)
  const bad = await fetch(`${BASE}/api/host/listings`, { method: "POST", headers: H(hostCookie), body: JSON.stringify({ city: "" }) });
  bad.status === 400 ? ok("POST invalid body → 400 (Zod)") : no(`status=${bad.status}`);

  // 6 — list includes it
  const list = await (await fetch(`${BASE}/api/host/listings`, { headers: H(hostCookie) })).json();
  list.listings?.some((l: { id: string }) => l.id === listingId) ? ok("GET list includes the draft") : no("draft not in list");

  // 7 — edit (PATCH)
  const patch = await fetch(`${BASE}/api/host/listings/${listingId}`, { method: "PATCH", headers: H(hostCookie), body: JSON.stringify({ title: "HTTP Edited Loft", price: 1234 }) });
  const patched = await patch.json();
  patch.status === 200 && patched.listing?.title === "HTTP Edited Loft" ? ok("PATCH edit → 200 (title updated)") : no(`status=${patch.status} title=${patched.listing?.title}`);

  // 8 — RBAC: traveler can't PATCH
  const patchDenied = await fetch(`${BASE}/api/host/listings/${listingId}`, { method: "PATCH", headers: H(travelerCookie), body: JSON.stringify({ title: "hax" }) });
  patchDenied.status === 403 ? ok("PATCH as traveler → 403") : no(`status=${patchDenied.status}`);

  // 9 — publish (draft → pending_review)
  const pub = await fetch(`${BASE}/api/host/listings/${listingId}/publish`, { method: "POST", headers: H(hostCookie) });
  const pubBody = await pub.json();
  pub.status === 200 && pubBody.listing?.status === "pending_review" ? ok("POST publish → 200 (pending_review)") : no(`status=${pub.status} ${JSON.stringify(pubBody)}`);

  // 10 — delete (soft)
  const del = await fetch(`${BASE}/api/host/listings/${listingId}`, { method: "DELETE", headers: H(hostCookie) });
  del.status === 200 ? ok("DELETE → 200 (soft delete)") : no(`status=${del.status}`);
  const list2 = await (await fetch(`${BASE}/api/host/listings`, { headers: H(hostCookie) })).json();
  !list2.listings?.some((l: { id: string }) => l.id === listingId) ? ok("deleted listing gone from list") : no("still listed");
} finally {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
  await closeQueues().catch(() => {});
  if (listingId) await queryAurora(`delete from listings where id = $1`, [listingId]).catch(() => {});
  await queryAurora(`delete from users where id = any($1::uuid[])`, [[host.id, traveler.id]]).catch(() => {});
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
