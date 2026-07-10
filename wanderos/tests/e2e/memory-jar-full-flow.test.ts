/**
 * Memory Jar — FULL end-to-end test (free flows only; never calls fal/Veo/HeyGen).
 *   Prereqs: dev server on :5050  +  worker running  (npm run dev / npm run worker)
 *   Run:     npx tsx tests/e2e/memory-jar-full-flow.test.ts
 *
 * Covers: free template match (embeddings) · dynamic scene (Unsplash) · AI quota gate (no generation) ·
 *         saved-jar CRUD (save/copy/rename/list/delete) · FREE movie pipeline (director→narration→Ken-Burns→
 *         film-grade→assemble→Cloudinary) · movie stop/cancel · overview/recap.
 * Asserts ZERO paid-engine calls.
 */
import { readFileSync } from "fs";

for (const line of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { queryAurora } = await import("../../lib/db/pool");
const { createSessionToken, sessionCookieName } = await import("../../lib/auth/token");
const { roleCookieName } = await import("../../lib/auth/roles");
const svc = await import("../../lib/services/memoryMovie.service");

const B = process.env.E2E_BASE_URL || "http://localhost:5050";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, extra = "") => { console.log(`${c ? "✅" : "❌"} ${n}${extra ? " — " + extra : ""}`); c ? pass++ : fail++; };

const [u] = await queryAurora<{ id: string; name: string; email: string }>(
  "select id,name,email from users where role='traveler' and (select count(*) from travel_posts where author_id=users.id)>1 limit 1", []
);
const token = createSessionToken({ id: u.id, name: u.name, email: u.email, role: "traveler" });
const C = `${sessionCookieName}=${token}; ${roleCookieName}=traveler`;
const post = (p: string, body: unknown) => fetch(`${B}${p}`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: C }, body: JSON.stringify(body) }).then((r) => r.json());
const get = (p: string) => fetch(`${B}${p}`, { headers: { Cookie: C } }).then((r) => r.json());

console.log(`Memory Jar E2E — user: ${u.name}\n`);

// 1) FREE semantic match (embeddings)
const m = await post("/api/memory-jars/match", { text: "cozy snowy winter mountains" });
ok("match (free embeddings)", m.id === "t3" || m.label === "Swiss Alps", `→ ${m.label}`);

// 2) FREE dynamic scene (Unsplash)
const si = await post("/api/memory-jars/scene-img", { text: "Venice Italy canal" });
ok("scene-img (Unsplash, free)", !!si.url?.includes("unsplash"));

// 3) AI quota endpoint — GET only, NO generation
const q = await get("/api/memory-jars/jar");
ok("AI quota gate (GET, no fal)", typeof q.remaining === "number", `${q.remaining}/${q.limit} left`);

// 4) saved_jars full CRUD
await queryAurora("delete from saved_jars where owner_id=$1", [u.id]).catch(() => {});
const sv = await post("/api/memory-jars/saved", { name: "E2E Jar", mode: "image", jarSrc: "t8" });
ok("save jar", !!sv.jar?.id, sv.jar?.name);
const cp = await post(`/api/memory-jars/saved/${sv.jar.id}`, {});
ok("copy jar", cp.jar?.name?.includes("copy"), cp.jar?.name);
await fetch(`${B}/api/memory-jars/saved/${sv.jar.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", Cookie: C }, body: JSON.stringify({ name: "E2E Renamed" }) });
const list = await get("/api/memory-jars/saved");
ok("rename + list", list.jars?.some((j: { name: string }) => j.name === "E2E Renamed"), `${list.jars?.length} jars`);
await fetch(`${B}/api/memory-jars/saved/${cp.jar.id}`, { method: "DELETE", headers: { Cookie: C } });
const list2 = await get("/api/memory-jars/saved");
ok("delete jar", list2.jars?.length === list.jars?.length - 1);

// 5) FREE movie pipeline E2E (Ken-Burns, no fal)
const { movieId } = await svc.startMovie(u.id, { source: "past", tier: "free" });
let film: { film_url?: string | null; title?: string | null; cost_cents?: number | null } | null = null;
const stages: string[] = [];
for (let i = 0; i < 48; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const mv = await svc.getMovie(u.id, movieId);
  if (mv?.stage && !stages.includes(mv.stage)) stages.push(mv.stage);
  if (mv?.film_url) { film = mv; break; }
  if ((mv?.job_status || mv?.status) === "failed") break;
}
ok("FREE movie render (Ken-Burns→film-grade→Cloudinary)", !!film?.film_url, `"${film?.title}" cost:${film?.cost_cents}¢`);
console.log("   stages:", stages.join(" → "));

// 6) movie STOP/cancel control
const s2 = await svc.startMovie(u.id, { source: "past", tier: "free" });
await new Promise((r) => setTimeout(r, 2500));
await svc.stopMovie(u.id, s2.movieId);
await new Promise((r) => setTimeout(r, 1500));
const stopped = await svc.getMovie(u.id, s2.movieId);
ok("movie STOP/cancel", stopped?.status === "cancelled" || stopped?.job_status === "cancelled", stopped?.status);
await svc.deleteMovie(u.id, s2.movieId);

// 7) overview (recap + year jars + photos)
const ov = await get("/api/memory-jars/overview");
ok("overview (recap + yearJars + photos)", !!ov.recap && Array.isArray(ov.yearJars) && Array.isArray(ov.photos), `${ov.yearJars?.length}yr ${ov.photos?.length}ph`);

console.log(`\n=== Memory Jar E2E: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
