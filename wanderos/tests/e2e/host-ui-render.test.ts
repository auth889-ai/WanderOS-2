/**
 * E2E (UI smoke) — boots the dev server and renders /host/listings/new with a real host session,
 * asserting the Studio page renders (catches import/runtime errors typecheck can't).
 *   Run: npm run test:e2e:ui
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

console.log("\n── E2E (UI smoke): /host/listings/new ──\n");

const [host] = await queryAurora<{ id: string }>(
  `insert into users (name, email, role) values ('UI Host', $1, 'host') returning id`,
  [`ui-${randomUUID()}@test.local`]
);
const cookie = `${sessionCookieName}=${createSessionToken({ id: host.id, name: "UI Host", email: "ui@test.local", role: "host" })}`;

let server: ChildProcess | null = null;
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
  server = spawn("npm run dev", { cwd: new URL("../../", import.meta.url).pathname, shell: true, detached: true, stdio: "ignore" });
  (await waitUp()) ? ok("dev server up") : no("dev server boot failed");

  // unauth → redirected to /login (status 200 of login or 307)
  const anon = await fetch(`${BASE}/host/listings/new`, { redirect: "manual" });
  [307, 302, 308].includes(anon.status) ? ok(`unauth → redirect (${anon.status})`) : no(`unauth status=${anon.status}`);

  // host → renders the studio
  const res = await fetch(`${BASE}/host/listings/new`, { headers: { Cookie: cookie } });
  const html = await res.text();
  res.status === 200 ? ok("host GET → 200") : no(`status=${res.status}`);
  html.includes("AI Listing Studio") ? ok("renders the Studio header") : no("studio header missing");
  html.includes("Tell the crew about it") ? ok("renders the brief form") : no("brief form missing");
} finally {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
  await queryAurora(`delete from users where id = $1`, [host.id]).catch(() => {});
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
