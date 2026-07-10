import { Pool, QueryResultRow } from "pg";

let pool: Pool | null = null;

export function getPool() {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  if (!pool) {
    // Strip sslmode from the URL: newer pg treats sslmode=require as verify-full, which
    // fails against Aurora's AWS CA ("unable to get local issuer certificate"). We connect
    // over TLS but skip CA verification via the explicit ssl object instead.
    const url = new URL(process.env.DATABASE_URL);
    const useSsl = url.searchParams.has("sslmode");
    url.searchParams.delete("sslmode");

    pool = new Pool({
      connectionString: url.toString(),
      // Aurora Serverless v2 scales to zero and cold-start resume can take ~15-25s,
      // so allow a generous connect timeout to avoid failing the first request.
      connectionTimeoutMillis: 30000,
      query_timeout: 60000,
      // Keep connections warm through long LLM gaps in a crew (Aurora may otherwise drop an
      // idle connection and the next query has to cold-resume). keepAlive + a longer idle window.
      idleTimeoutMillis: 60000,
      keepAlive: true,
      max: 5,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined
    });

    // An idle client erroring (e.g. Aurora scaled down and killed it) must NOT crash the process.
    pool.on("error", (err) => {
      console.warn(`[pool] idle client error (ignored): ${err.message}`);
    });
  }

  return pool;
}

const TRANSIENT = /timeout|terminated|ECONNRESET|ECONNREFUSED|socket hang up|Connection terminated/i;

/** Query Aurora with one retry on a transient connection error (Serverless v2 cold-resume / dropped conn). */
export async function queryAurora<T extends QueryResultRow>(sql: string, params: unknown[] = []) {
  const db = getPool();
  if (!db) {
    throw new Error("DATABASE_URL is not configured. Demo mode is active.");
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await db.query<T>(sql, params);
      return result.rows;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === 1 || !TRANSIENT.test(msg)) throw err;
      await new Promise((r) => setTimeout(r, 1500)); // brief backoff, then retry once
    }
  }
  throw lastErr;
}
