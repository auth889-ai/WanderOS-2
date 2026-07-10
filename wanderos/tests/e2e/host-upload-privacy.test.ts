/**
 * E2E — real photo upload (from test_photos) + cross-host privacy. Boots a dev server on :5061.
 *   Run: npm run test:e2e:upload
 * Proves: (1) a host can upload real photos and they flow API → service → agent_jobs.input;
 *         (2) a DIFFERENT host cannot read/edit/stream/cancel that listing (RBAC ownership, incl. SSE).
 * Cancels the job so the crew never runs (no LLM cost).
 */
import { readFileSync, readdirSync } from "fs";
import { randomUUID } from "crypto";
import { spawn, ChildProcess } from "child_process";

for (const line of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("#") || line.trim().startsWith("//")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { queryAurora } = await import("../../lib/db/pool");
const { getJob } = await import("../../lib/db/tables/agent-jobs");
const { createSessionToken, sessionCookieName } = await import("../../lib/auth/token");

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);
const BASE = "http://localhost:5050";

console.log("\n── E2E: photo upload (test_photos) + cross-host privacy ──\n");

// two hosts
const mk = async (label: string) =>
  (await queryAurora<{ id: string }>(`insert into users (name, email, role) values ($1, $2, 'host') returning id`, [label, `${label}-${randomUUID()}@test.local`]))[0];
const hostA = await mk("UploadHostA");
const hostB = await mk("UploadHostB");
const cookieA = `${sessionCookieName}=${createSessionToken({ id: hostA.id, name: "A", email: "a@t.local", role: "host" })}`;
const cookieB = `${sessionCookieName}=${createSessionToken({ id: hostB.id, name: "B", email: "b@t.local", role: "host" })}`;
const H = (c: string) => ({ "Content-Type": "application/json", Cookie: c });

// real photos from test_photos (uploaded one-by-one to Cloudinary → URLs)
const dir = new URL("../../test_photos/", import.meta.url);
const photoFiles = readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
const photoBuffers = photoFiles.map((f) => ({ name: f, buf: readFileSync(new URL(f, dir)) }));

let server: ChildProcess | null = null;
let listingId = "";
async function waitUp(timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/auth/me`);
      if (r.status > 0) return true;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

try {
  console.log(`Uploading ${photoBuffers.length} real photos from test_photos/ …\n`);
  // reuse the already-running dev server if present; otherwise boot one
  let up = await waitUp(2000);
  if (!up) {
    server = spawn("npm run dev", { cwd: new URL("../../", import.meta.url).pathname, shell: true, detached: true, stdio: "ignore" });
    up = await waitUp();
  }
  up ? ok("dev server reachable (:5050)") : no("server not reachable");

  // 1 — host A uploads each real photo → Cloudinary URL (the real UI flow)
  const photos: string[] = [];
  for (const p of photoBuffers) {
    const fd = new FormData();
    fd.append("file", new Blob([p.buf], { type: "image/png" }), p.name);
    const r = await fetch(`${BASE}/api/host/uploads`, { method: "POST", headers: { Cookie: cookieA }, body: fd });
    const b = await r.json().catch(() => ({}));
    if (r.status === 200 && b.url) photos.push(b.url);
  }
  photos.length === photoBuffers.length ? ok(`uploaded ${photos.length} photos → Cloudinary URLs`) : no(`only ${photos.length}/${photoBuffers.length} uploaded`);
  photos[0]?.startsWith("http") ? ok(`real hosted URL (${photos[0]?.slice(0, 42)}…)`) : no("not a hosted URL");

  // 2 — host A creates the draft with the URLs (tiny body now)
  const res = await fetch(`${BASE}/api/host/listings`, {
    method: "POST",
    headers: H(cookieA),
    body: JSON.stringify({ city: "Dubai", country: "UAE", category: "apartment", notes: "test upload", photos })
  });
  const body = await res.json().catch(() => ({}));
  listingId = body.listingId;
  res.status === 202 && listingId ? ok(`POST create → 202 (${photos.length} photo URLs)`) : no(`status=${res.status} body=${JSON.stringify(body).slice(0, 200)}`);

  // 3 — photos reached agent_jobs.input + the draft got a cover image
  if (body.jobId) {
    const job = await getJob(body.jobId);
    const stored = (job?.input as { photos?: string[] })?.photos ?? [];
    stored.length === photos.length ? ok(`all ${stored.length} photo URLs in agent_jobs.input`) : no(`stored ${stored.length}/${photos.length}`);
  }
  const [row] = await queryAurora<{ image_url: string | null }>(`select image_url from listings where id = $1`, [listingId]);
  row?.image_url?.startsWith("http") ? ok("listing got a cover image (image_url set)") : no(`cover image_url=${row?.image_url}`);

  // 3 — cancel so the crew never runs
  const cancel = await fetch(`${BASE}/api/host/listings/${listingId}/cancel`, { method: "POST", headers: H(cookieA) });
  cancel.status === 200 ? ok("host A cancelled the job (no crew run)") : no(`cancel status=${cancel.status}`);

  // 4 — PRIVACY: host B must NOT access host A's listing
  const bGet = await fetch(`${BASE}/api/host/listings/${listingId}`, { headers: H(cookieB) });
  bGet.status === 404 ? ok("host B GET A's listing → 404") : no(`B GET status=${bGet.status}`);
  const bPatch = await fetch(`${BASE}/api/host/listings/${listingId}`, { method: "PATCH", headers: H(cookieB), body: JSON.stringify({ title: "hax" }) });
  bPatch.status === 403 ? ok("host B PATCH A's listing → 403") : no(`B PATCH status=${bPatch.status}`);
  const bStream = await fetch(`${BASE}/api/host/listings/${listingId}/stream`, { headers: H(cookieB) });
  bStream.status === 404 ? ok("host B STREAM A's job → 404 (SSE ownership fix)") : no(`B STREAM status=${bStream.status}`);
  const bCancel = await fetch(`${BASE}/api/host/listings/${listingId}/cancel`, { method: "POST", headers: H(cookieB) });
  bCancel.status === 400 ? ok("host B CANCEL A's job → rejected") : no(`B CANCEL status=${bCancel.status}`);
} finally {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
  if (listingId) await queryAurora(`delete from listings where id = $1`, [listingId]).catch(() => {});
  await queryAurora(`delete from users where id = any($1::uuid[])`, [[hostA.id, hostB.id]]).catch(() => {});
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
