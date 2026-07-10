/**
 * Multi-provider LLM gateway + RAG check.
 *   Run:  node tests/check-llm-providers.mjs
 *
 * Verifies each configured chat provider responds, embeddings return 768 dims, and a full
 * embed -> store -> semantic-search roundtrip works on Aurora pgvector.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
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

let pass = 0,
  fail = 0;
const ok = (m) => (console.log(`✅ ${m}`), pass++);
const no = (m) => (console.log(`❌ ${m}`), fail++);
const word = (r) => (typeof r.content === "string" ? r.content : JSON.stringify(r.content)).trim().slice(0, 40);

console.log("\n── LLM gateway + RAG check ──\n");

// 1. Gemini chat
if (env.GEMINI_API_KEY) {
  try {
    const m = new ChatGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY, model: "gemini-2.5-flash", maxRetries: 1 });
    ok(`gemini chat OK ("${word(await m.invoke("Reply one word: OK"))}")`);
  } catch (e) {
    no(`gemini chat: ${e.message.slice(0, 80)}`);
  }
}

// 2. OpenAI-compatible providers
const compat = [
  ["openai", env.OPENAI_API_KEY, undefined, env.OPENAI_MODEL || "gpt-4o-mini"],
  ["openrouter", env.OPENROUTER_API_KEY, "https://openrouter.ai/api/v1", env.OPENROUTER_MODEL || "openai/gpt-4o-mini"],
  ["groq", env.GROQ_API_KEY, "https://api.groq.com/openai/v1", env.GROQ_MODEL || "llama-3.3-70b-versatile"]
];
for (const [name, key, baseURL, model] of compat) {
  if (!key) {
    console.log(`➖ ${name} (no key, skipped)`);
    continue;
  }
  try {
    const m = new ChatOpenAI({ apiKey: key, model, maxRetries: 1, ...(baseURL ? { configuration: { baseURL } } : {}) });
    ok(`${name} chat OK [${model}] ("${word(await m.invoke("Reply one word: OK"))}")`);
  } catch (e) {
    no(`${name} chat [${model}]: ${e.message.slice(0, 90)}`);
  }
}

// 3. Embeddings (locked: gemini-embedding-001 @ 768)
async function embed(text) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${env.GEMINI_API_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: { parts: [{ text }] }, outputDimensionality: 768 }) }
  );
  return (await r.json()).embedding?.values;
}
let emb;
try {
  emb = await embed("peaceful trip to Kyoto");
  emb?.length === 768 ? ok("embeddings return 768 dims") : no(`embeddings wrong dims: ${emb?.length}`);
} catch (e) {
  no(`embeddings: ${e.message.slice(0, 80)}`);
}

// 4. RAG roundtrip on Aurora
if (env.DATABASE_URL && emb?.length === 768) {
  const url = new URL(env.DATABASE_URL);
  url.searchParams.delete("sslmode");
  const pool = new pg.Pool({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
  const lit = (v) => `[${v.join(",")}]`;
  try {
    const docs = [
      "Cox's Bazar: world's longest sea beach, great budget Eid beach trip.",
      "Kyoto Japan: cherry blossoms, quiet temples, peaceful spring mornings."
    ];
    for (const d of docs) {
      await pool.query(
        "insert into embeddings(owner_type,owner_id,content,embedding,metadata) values('research',gen_random_uuid(),$1,$2::vector,'{\"_test\":true}'::jsonb)",
        [d, lit(await embed(d))]
      );
    }
    const qe = await embed("where should I go for a calm peaceful trip?");
    const r = await pool.query(
      "select content, 1-(embedding <=> $1::vector) sim from embeddings where metadata->>'_test'='true' order by embedding <=> $1::vector limit 1",
      [lit(qe)]
    );
    const top = r.rows[0];
    top && /kyoto/i.test(top.content)
      ? ok(`RAG search correct — top match: "${top.content.slice(0, 30)}..." (sim ${top.sim.toFixed(2)})`)
      : no(`RAG search returned: ${top?.content?.slice(0, 40)}`);
    await pool.query("delete from embeddings where metadata->>'_test'='true'");
  } catch (e) {
    no(`RAG roundtrip: ${e.message.slice(0, 90)}`);
  } finally {
    await pool.end();
  }
}

console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
process.exit(fail ? 1 : 0);
