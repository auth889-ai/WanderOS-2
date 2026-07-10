import { embedText } from "@/lib/ai/llm";
import { insertEmbedding, searchSimilar, EmbeddingHit, OwnerType } from "@/lib/db/tables/embeddings";

/**
 * pgvector-retriever — the shared RAG capability every strong agent uses.
 *
 * remember(): embed + store content into WanderOS's memory (Aurora pgvector).
 * retrieve(): embed a query → semantic-search the most relevant memories.
 * toGroundedContext(): format hits as a prompt block + the source ids (for grounding/citation).
 *
 * This is what lets agents reason over real data (similar listings, past research, market
 * context) instead of guessing — and cite source_ids so answers are grounded, not hallucinated.
 */
export async function remember(params: {
  ownerType: OwnerType;
  ownerId: string;
  content: string;
  metadata?: Record<string, unknown>;
}) {
  const embedding = await embedText(params.content);
  return insertEmbedding({ ...params, embedding });
}

export async function retrieve(params: {
  query: string;
  limit?: number;
  ownerTypes?: OwnerType[];
  userId?: string;
}): Promise<EmbeddingHit[]> {
  const embedding = await embedText(params.query);
  return searchSimilar({ embedding, limit: params.limit, ownerTypes: params.ownerTypes, userId: params.userId });
}

/** Format retrieved hits as a grounded context block for a prompt, plus the source ids. */
export function toGroundedContext(hits: EmbeddingHit[]): { context: string; sourceIds: string[] } {
  if (!hits.length) return { context: "(no relevant memory found)", sourceIds: [] };
  const context = hits
    .map((h, i) => `[${i + 1}] (${h.owner_type}, similarity ${h.similarity.toFixed(2)}) ${h.content}`)
    .join("\n");
  return { context, sourceIds: hits.map((h) => h.id) };
}
