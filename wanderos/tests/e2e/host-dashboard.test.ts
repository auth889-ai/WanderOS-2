/**
 * E2E — the host dashboard shows the host's OWN listings only (privacy) + renders cards/stats.
 *   Run: npm run test:e2e:dashboard
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

console.log("\n── E2E: host dashboard (own listings only) ──\n");

const mk = async (label: string) =>
  (await queryAurora<{ id: string }>(`insert into users (name, email, role) values ($1, $2, 'host') returning id`, [label, `${label}-${randomUUID()}@test.local`]))[0];
const owner = await mk("DashOwner");
const other = await mk("DashOther");

const newListing = (hostId: string, title: string, status: string) =>
  queryAurora(
    `insert into listings (host_id, title, description, city, country, category, price, status, moderation_status)
     values ($1,$2,'desc','Dubai','UAE','villa',2200,$3,'pending_review')`,
    [hostId, title, status]
  );
await newListing(owner.id, "DASH Owner Villa One", "draft");
await newListing(owner.id, "DASH Owner Villa Two", "pending_review");
await newListing(other.id, "DASH Other Secret Villa", "draft");

let server: ChildProcess | null = null;
async function waitUp(timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/auth/me`);
      if (r.status > 0) return true;
    } catch {
      /* down */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

try {
  let up = await waitUp(2000);
  if (!up) {
    server = spawn("npm run dev", { cwd: new URL("../../", import.meta.url).pathname, shell: true, detached: true, stdio: "ignore" });
    up = await waitUp();
  }
  up ? ok("dev server reachable") : no("server not reachable");

  const cookie = `${sessionCookieName}=${createSessionToken({ id: owner.id, name: "Owner", email: "o@t.local", role: "host" })}`;
  const res = await fetch(`${BASE}/host/dashboard`, { headers: { Cookie: cookie } });
  const html = await res.text();
  res.status === 200 ? ok("GET dashboard → 200") : no(`status=${res.status}`);
  html.includes("DASH Owner Villa One") ? ok("shows owner's listing #1") : no("missing owner listing 1");
  html.includes("DASH Owner Villa Two") ? ok("shows owner's listing #2") : no("missing owner listing 2");
  html.includes("Pending review") ? ok("renders status badge") : no("no status badge");
  html.includes("Your listings") ? ok("renders dashboard heading") : no("no heading");
  !html.includes("DASH Other Secret Villa") ? ok("PRIVACY — does NOT show another host's listing") : no("LEAK: showed another host's listing");
} finally {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
  await queryAurora(`delete from listings where host_id = any($1::uuid[])`, [[owner.id, other.id]]).catch(() => {});
  await queryAurora(`delete from users where id = any($1::uuid[])`, [[owner.id, other.id]]).catch(() => {});
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
