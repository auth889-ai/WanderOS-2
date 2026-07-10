/**
 * Apply all SQL migrations in lib/db/migrations (sorted) to Aurora. Idempotent: every migration
 * uses `create table/index if not exists` and `add column if not exists`, so re-running is safe.
 *   Run: npm run db:migrate
 */
import { readFileSync, readdirSync } from "fs";

// load .env.local (same pattern as the tests)
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("#") || line.trim().startsWith("//")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (k && !(k in process.env)) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const { queryAurora } = await import("../lib/db/pool");

const dir = new URL("../lib/db/migrations/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

console.log(`\n── applying ${files.length} migration(s) ──\n`);
for (const file of files) {
  const sql = readFileSync(new URL(file, dir), "utf8");
  process.stdout.write(`  ${file} ... `);
  try {
    await queryAurora(sql);
    console.log("✅");
  } catch (err) {
    console.log("❌");
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
console.log("\n✅ migrations applied.\n");
process.exit(0);
