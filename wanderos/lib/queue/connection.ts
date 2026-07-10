import type { RedisOptions } from "ioredis";

/**
 * BullMQ Redis connection (Upstash). We pass connection OPTIONS (not an ioredis instance) so BullMQ
 * owns the connection lifecycle — this avoids the dual-ioredis type/runtime clash (BullMQ bundles its
 * own ioredis) and lets each Queue/Worker get the right connection it needs.
 * Two rules that matter: `maxRetriesPerRequest: null` is REQUIRED by BullMQ; `rediss://` → TLS.
 */
function requireUrl(): string {
  if (!process.env.REDIS_URL) {
    throw new Error("REDIS_URL is not set. Add your Upstash connection string to .env.local.");
  }
  return process.env.REDIS_URL;
}

export function redisConnectionOptions(): RedisOptions {
  const url = new URL(requireUrl());
  return {
    host: url.hostname,
    port: Number(url.port || "6379"),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false
  };
}
