/**
 * WanderOS foundation health-check.
 *   Run:  node tests/check-foundation.mjs
 *
 * Verifies the spine is real before building features on it:
 *   1. .env.local loads + required keys present
 *   2. Gemini LLM responds (live)
 *   3. Aurora PostgreSQL connects
 *   4. pgvector extension installed
 *   5. core tables exist
 *
 * Dependency-free (uses pg + @langchain/google-genai already installed).
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  try {
    const raw = readFileSync(join(ROOT, ".env.local"), "utf8");
    return Object.fromEntries(
      raw
        .split("\n")
        .filter((l) => l.includes("=") && !l.trim().startsWith("//") && !l.trim().startsWith("#"))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
        })
    );
  } catch {
    return {};
  }
}

const env = loadEnv();
let pass = 0;
let fail = 0;
const ok = (m) => (console.log(`✅ ${m}`), pass++);
const no = (m) => (console.log(`❌ ${m}`), fail++);

console.log("\n── WanderOS foundation check ──\n");

// 1. env / keys
const geminiKey = env.GEMINI_API_KEY || env.GOOGLE_GENERATIVE_AI_API_KEY;
geminiKey ? ok("GEMINI_API_KEY present") : no("GEMINI_API_KEY missing");
env.DATABASE_URL ? ok("DATABASE_URL present") : no("DATABASE_URL missing");

// 2. Gemini live
if (geminiKey) {
  try {
    const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
    const m = new ChatGoogleGenerativeAI({ apiKey: geminiKey, model: "gemini-2.5-flash", maxRetries: 1 });
    const r = await m.invoke("Reply with one word: OK");
    const text = (typeof r.content === "string" ? r.content : JSON.stringify(r.content)).trim();
    text.toUpperCase().includes("OK") ? ok(`Gemini responded ("${text}")`) : no(`Gemini odd reply ("${text}")`);
  } catch (e) {
    no(`Gemini call failed: ${e.message}`);
  }
}

// 3-5. Aurora + pgvector + tables
if (env.DATABASE_URL) {
  try {
    const pg = (await import("pg")).default;
    const url = new URL(env.DATABASE_URL);
    const useSsl = url.searchParams.has("sslmode");
    url.searchParams.delete("sslmode"); // avoid pg verify-full against Aurora's CA
    const pool = new pg.Pool({
      connectionString: url.toString(),
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 8000
    });
    await pool.query("select 1");
    ok("Aurora PostgreSQL connected");

    const ext = await pool.query("select 1 from pg_extension where extname='vector'");
    ext.rowCount ? ok("pgvector installed") : no("pgvector NOT installed (run: create extension vector;)");

    const expected = ["users", "listings", "trips", "bookings", "memory_jars", "agent_runs", "agent_steps", "embeddings"];
    const found = (
      await pool.query("select table_name from information_schema.tables where table_schema='public'")
    ).rows.map((r) => r.table_name);
    const missing = expected.filter((t) => !found.includes(t));
    missing.length === 0
      ? ok(`core tables present (${expected.length})`)
      : no(`missing tables: ${missing.join(", ")} (run schema.sql)`);

    await pool.end();
  } catch (e) {
    no(`Aurora connection failed: ${e.message} — open the RDS security group (inbound 5432) + set Publicly accessible`);
  }
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
