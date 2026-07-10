import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

/**
 * The ONE LLM gateway for WanderOS.
 *
 * Every agent calls getModel(tier) and does NOT know which provider answers — so we can
 * route a tier to Gemini, OpenAI, OpenRouter, or Groq by config. This is the production
 * pattern (one interface, swappable providers), the opposite of travelmate's 4-SDK sprawl.
 *
 * Multi-provider CHAT is fine. EMBEDDINGS are locked to ONE model (gemini-embedding-001 @
 * 768 dims) because the pgvector column is vector(768) — mixing embedding spaces breaks RAG.
 *
 * Tiers (logical roles, not providers):
 *   "flash"     fast/cheap   -> routing, classification, most agents (Gemini)
 *   "pro"       high quality -> final narration / synthesis (Gemini)
 *   "reasoning" heavy reason -> copy / hard reasoning (OpenAI)
 *   "extract"   ultra-fast deterministic extraction -> structured facts (Groq)
 *   "safety"    careful policy/safety review -> trust & safety (Claude via OpenRouter)
 */
export type ModelTier = "flash" | "pro" | "reasoning" | "extract" | "safety";
export type Provider = "gemini" | "openai" | "openrouter" | "groq";

type TierConfig = { provider: Provider; model: string; temperature: number; maxTokens?: number };

const env = (k: string) => process.env[k];

// Defaults are Gemini-first; override any tier via env (LLM_<TIER>_PROVIDER / _MODEL).
const TIERS: Record<ModelTier, TierConfig> = {
  flash: {
    provider: (env("LLM_FLASH_PROVIDER") as Provider) || "gemini",
    model: env("LLM_FLASH_MODEL") || "gemini-2.5-flash",
    temperature: 0.3
  },
  pro: {
    provider: (env("LLM_PRO_PROVIDER") as Provider) || "gemini",
    model: env("LLM_PRO_MODEL") || "gemini-2.5-pro",
    temperature: 0.7
  },
  reasoning: {
    // OpenAI direct — reliable (OpenRouter free models rate-limit). Used where a non-Gemini
    // model is best, e.g. the copywriter. Override with LLM_REASONING_PROVIDER/_MODEL.
    provider: (env("LLM_REASONING_PROVIDER") as Provider) || "openai",
    model: env("LLM_REASONING_MODEL") || env("OPENAI_MODEL") || "gpt-4o-mini",
    temperature: 0.6
  },
  extract: {
    // Groq — ultra-low-latency inference for deterministic structured extraction.
    provider: (env("LLM_EXTRACT_PROVIDER") as Provider) || "groq",
    model: env("LLM_EXTRACT_MODEL") || "llama-3.3-70b-versatile",
    temperature: 0.1
  },
  safety: {
    // Claude (via OpenRouter) — the strongest careful policy/safety reviewer.
    provider: (env("LLM_SAFETY_PROVIDER") as Provider) || "openrouter",
    model: env("LLM_SAFETY_MODEL") || "anthropic/claude-haiku-4.5",
    temperature: 0.1,
    maxTokens: 2000 // cap the output ceiling so OpenRouter credit checks pass
  }
};

const OPENAI_COMPATIBLE_BASE: Partial<Record<Provider, string>> = {
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1"
  // openai -> default base url
};

const PROVIDER_KEY: Record<Provider, () => string | undefined> = {
  gemini: () => env("GEMINI_API_KEY") || env("GOOGLE_GENERATIVE_AI_API_KEY"),
  openai: () => env("OPENAI_API_KEY"),
  openrouter: () => env("OPENROUTER_API_KEY"),
  groq: () => env("GROQ_API_KEY")
};

const cache = new Map<string, BaseChatModel>();

function build(cfg: TierConfig): BaseChatModel {
  const apiKey = PROVIDER_KEY[cfg.provider]();
  if (!apiKey) {
    throw new Error(`No API key for provider "${cfg.provider}". Set the matching *_API_KEY in .env.local.`);
  }

  if (cfg.provider === "gemini") {
    return new ChatGoogleGenerativeAI({
      apiKey,
      model: cfg.model,
      temperature: cfg.temperature,
      maxRetries: 2,
      ...(cfg.maxTokens ? { maxOutputTokens: cfg.maxTokens } : {})
    });
  }

  // openai / openrouter / groq are all OpenAI-compatible
  const baseURL = OPENAI_COMPATIBLE_BASE[cfg.provider];
  return new ChatOpenAI({
    apiKey,
    model: cfg.model,
    temperature: cfg.temperature,
    maxRetries: 2,
    ...(cfg.maxTokens ? { maxTokens: cfg.maxTokens } : {}),
    ...(baseURL ? { configuration: { baseURL } } : {})
  });
}

/** Memoized chat model for a logical tier. Lazy: nothing is constructed until first use. */
export function getModel(tier: ModelTier = "flash"): BaseChatModel {
  const cfg = TIERS[tier];
  const key = `${cfg.provider}:${cfg.model}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const model = build(cfg);
  cache.set(key, model);
  return model;
}

// ── Embeddings (locked to one model so the 768-dim vector space is consistent) ──────────

const EMBEDDING_MODEL = env("GEMINI_EMBEDDING_MODEL") || "gemini-embedding-001";
const EMBEDDING_DIMS = 768; // must match embeddings.vector(768)

/** Embed one string -> number[768] via Gemini. Used by the pgvector retriever + embed tool. */
export async function embedText(text: string): Promise<number[]> {
  const apiKey = PROVIDER_KEY.gemini();
  if (!apiKey) throw new Error("GEMINI_API_KEY is required for embeddings.");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: { parts: [{ text }] }, outputDimensionality: EMBEDDING_DIMS })
    }
  );

  if (!res.ok) {
    throw new Error(`Embedding request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { embedding?: { values?: number[] } };
  const values = json.embedding?.values;
  if (!values || values.length !== EMBEDDING_DIMS) {
    throw new Error(`Embedding returned ${values?.length ?? 0} dims, expected ${EMBEDDING_DIMS}.`);
  }
  return values;
}
