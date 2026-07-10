/**
 * E2E (HTTP) - social compose/upload API over real HTTP.
 *   Run: npm run test:e2e:social-compose
 *
 * Proves S5 route privacy:
 * traveler-only media upload validation, post compose enqueue, and owner-only compose access.
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

let pass = 0;
let fail = 0;
const ok = (m: string) => (console.log(`✅ ${m}`), pass++);
const no = (m: string) => (console.log(`❌ ${m}`), fail++);

const BASE = "http://localhost:5050";
console.log("\n── E2E (HTTP): social compose/upload API ──\n");

async function createUser(role: "traveler" | "host", label: string) {
  const [user] = await queryAurora<{ id: string; email: string }>(
    `insert into users (name, email, role) values ($1,$2,$3) returning id, email`,
    [`Social Compose ${label}`, `social-compose-http-${label}-${randomUUID()}@test.local`, role]
  );
  return user;
}

const author = await createUser("traveler", "author");
const other = await createUser("traveler", "other");
const host = await createUser("host", "host");

const authorCookie = `${sessionCookieName}=${createSessionToken({
  id: author.id,
  name: "Social Compose Author",
  email: author.email,
  role: "traveler"
})}`;
const otherCookie = `${sessionCookieName}=${createSessionToken({
  id: other.id,
  name: "Social Compose Other",
  email: other.email,
  role: "traveler"
})}`;
const hostCookie = `${sessionCookieName}=${createSessionToken({
  id: host.id,
  name: "Social Compose Host",
  email: host.email,
  role: "host"
})}`;

const H = (cookie?: string) => ({ "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) });
const transparentPngDataUri =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

let server: ChildProcess | null = null;
let postId = "";
let jobId = "";

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

try {
  console.log("booting next dev (port 5050)...");
  server = spawn("npm run dev", { cwd: new URL("../../", import.meta.url).pathname, shell: true, detached: true, stdio: "ignore" });
  const up = await waitForServer();
  up ? ok("dev server is up") : no("dev server did not start in time");
  if (!up) throw new Error("server boot failed");

  const unauthUpload = await fetch(`${BASE}/api/posts/uploads`, {
    method: "POST",
    headers: H(),
    body: JSON.stringify({ dataUri: "data:image/png;base64,AA==" })
  });
  unauthUpload.status === 401 ? ok("POST /api/posts/uploads without session -> 401") : no(`unauth upload=${unauthUpload.status}`);

  const hostUpload = await fetch(`${BASE}/api/posts/uploads`, {
    method: "POST",
    headers: H(hostCookie),
    body: JSON.stringify({ dataUri: "data:image/png;base64,AA==" })
  });
  hostUpload.status === 403 ? ok("POST /api/posts/uploads as host -> 403") : no(`host upload=${hostUpload.status}`);

  const invalidUpload = await fetch(`${BASE}/api/posts/uploads`, {
    method: "POST",
    headers: H(authorCookie),
    body: JSON.stringify({ dataUri: "data:text/plain;base64,SGVsbG8=" })
  });
  invalidUpload.status === 400 ? ok("POST /api/posts/uploads rejects non-media") : no(`invalid upload=${invalidUpload.status}`);

  const validUpload = await fetch(`${BASE}/api/posts/uploads`, {
    method: "POST",
    headers: H(authorCookie),
    body: JSON.stringify({ dataUri: transparentPngDataUri })
  });
  const uploaded = await validUpload.json().catch(() => ({}));
  validUpload.status === 201 && uploaded.mediaUrl?.startsWith("https://")
    ? ok("POST /api/posts/uploads accepts valid photo -> Cloudinary URL")
    : no(`valid upload=${validUpload.status} ${JSON.stringify(uploaded)}`);

  const multipartBody = new FormData();
  multipartBody.append(
    "file",
    new Blob([Buffer.from(transparentPngDataUri.slice(transparentPngDataUri.indexOf(",") + 1), "base64")], {
      type: "image/png"
    }),
    "tiny-social-photo.png"
  );
  const multipartUpload = await fetch(`${BASE}/api/posts/uploads`, {
    method: "POST",
    headers: { Cookie: authorCookie },
    body: multipartBody
  });
  const multipartUploaded = await multipartUpload.json().catch(() => ({}));
  multipartUpload.status === 201 && multipartUploaded.mediaUrl?.startsWith("https://")
    ? ok("POST /api/posts/uploads accepts multipart photo -> Cloudinary URL")
    : no(`multipart upload=${multipartUpload.status} ${JSON.stringify(multipartUploaded)}`);

  const create = await fetch(`${BASE}/api/posts`, {
    method: "POST",
    headers: H(authorCookie),
    body: JSON.stringify({
      title: "Social compose HTTP draft",
      caption: "Draft for compose enqueue.",
      destination: "Kyoto",
      location: "Gion",
      tags: ["Kyoto", "culture"]
    })
  });
  const created = await create.json();
  postId = created.post?.id;
  create.status === 201 && postId ? ok("POST /api/posts creates compose draft") : no(`create=${create.status} ${JSON.stringify(created)}`);

  const otherCompose = await fetch(`${BASE}/api/posts/${postId}/compose`, {
    method: "POST",
    headers: H(otherCookie)
  });
  otherCompose.status === 404 ? ok("POST compose as another traveler -> 404") : no(`other compose=${otherCompose.status}`);

  const compose = await fetch(`${BASE}/api/posts/${postId}/compose`, {
    method: "POST",
    headers: H(authorCookie)
  });
  const composed = await compose.json();
  jobId = composed.jobId;
  compose.status === 202 && jobId ? ok("POST compose as owner -> 202 + jobId") : no(`compose=${compose.status} ${JSON.stringify(composed)}`);

  const [job] = await queryAurora<{ type: string; status: string; user_id: string; input: Record<string, unknown> }>(
    `select type, status, user_id, input from agent_jobs where id = $1`,
    [jobId]
  );
  job?.type === "social_post" ? ok("compose persisted social_post job") : no(`job type=${job?.type}`);
  job?.user_id === author.id ? ok("compose job is owned by author") : no(`job user=${job?.user_id}`);
  job?.input?.postId === postId ? ok("compose job input references post") : no("job input missing postId");

  const [post] = await queryAurora<{ compose_job_id: string | null }>(
    `select compose_job_id from travel_posts where id = $1`,
    [postId]
  );
  post?.compose_job_id === jobId ? ok("post stores compose_job_id") : no(`compose_job_id=${post?.compose_job_id}`);
} finally {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
  if (jobId) await queryAurora(`delete from agent_jobs where id = $1`, [jobId]).catch(() => {});
  if (postId) await queryAurora(`delete from travel_posts where id = $1`, [postId]).catch(() => {});
  await queryAurora(`delete from users where id = any($1::uuid[])`, [[author.id, other.id, host.id]]).catch(() => {});
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
