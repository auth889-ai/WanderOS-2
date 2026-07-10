/**
 * Seed demo users (one per role) into Aurora so login can be tested/demoed.
 *   Run:  node tests/seed-users.mjs
 * Idempotent: re-running resets the demo passwords.
 *
 * Credentials (demo only):
 *   traveler@wanderos.app / demo1234
 *   host@wanderos.app     / demo1234
 *   admin@wanderos.app    / demo1234
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import pg from "pg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(ROOT, ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("//") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    })
);

// must match lib/auth/password.ts
function hashPassword(pw) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(pw, salt, 120000, 64, "sha512").toString("hex");
  return `pbkdf2:120000:${salt}:${hash}`;
}

const users = [
  { name: "Demo Traveler", email: "traveler@wanderos.app", role: "traveler" },
  { name: "Demo Host", email: "host@wanderos.app", role: "host" },
  { name: "Demo Admin", email: "admin@wanderos.app", role: "admin" }
];

const url = new URL(env.DATABASE_URL);
url.searchParams.delete("sslmode");
const pool = new pg.Pool({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });

for (const u of users) {
  await pool.query(
    `insert into users (name, email, password_hash, role, status)
     values ($1, lower($2), $3, $4, 'active')
     on conflict (email) do update set password_hash = excluded.password_hash, role = excluded.role`,
    [u.name, u.email, hashPassword("demo1234"), u.role]
  );
  console.log(`✅ ${u.email}  (${u.role})  password: demo1234`);
}

await pool.end();
console.log("\nDone. Log in with any of the above at /login.\n");
