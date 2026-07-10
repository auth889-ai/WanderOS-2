import { queryAurora } from "../pool";

/**
 * The only module that touches the `embeddings` table (pgvector).
 * This is WanderOS's shared long-term memory: research, posts, listings, memories are
 * embedded here (768-dim) and retrieved by every agent crew for source-grounded answers.
 */
export type OwnerType = "research" | "post" | "listing" | "memory" | "festival" | "trip";

export type EmbeddingHit = {
  id: string;
  owner_type: string;
  owner_id: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number; // 0..1 (cosine), higher = closer
};

/** pgvector wants a literal like '[0.1,0.2,...]'. */
function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

export async function insertEmbedding(params: {
  ownerType: OwnerType;
  ownerId: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}) {
  const rows = await queryAurora<{ id: string }>(
    `insert into embeddings (owner_type, owner_id, content, embedding, metadata)
     values ($1, $2, $3, $4::vector, $5::jsonb)
     returning id`,
    [
      params.ownerType,
      params.ownerId,
      params.content,
      toVectorLiteral(params.embedding),
      JSON.stringify(params.metadata || {})
    ]
  );
  return rows[0];
}

/**
 * Approximate-nearest-neighbour search by cosine similarity.
 * Optionally scope by owner type(s) and/or a user via metadata->>'userId'.
 */
export async function searchSimilar(params: {
  embedding: number[];
  limit?: number;
  ownerTypes?: OwnerType[];
  userId?: string;
}): Promise<EmbeddingHit[]> {
  const filters: string[] = [];
  const values: unknown[] = [toVectorLiteral(params.embedding)];

  if (params.ownerTypes?.length) {
    values.push(params.ownerTypes);
    filters.push(`owner_type = any($${values.length})`);
  }
  if (params.userId) {
    values.push(params.userId);
    filters.push(`metadata->>'userId' = $${values.length}`);
  }
  values.push(params.limit ?? 5);
  const limitParam = `$${values.length}`;

  const where = filters.length ? `where ${filters.join(" and ")}` : "";

  return queryAurora<EmbeddingHit>(
    `select id, owner_type, owner_id, content, metadata,
            1 - (embedding <=> $1::vector) as similarity
     from embeddings
     ${where}
     order by embedding <=> $1::vector
     limit ${limitParam}`,
    values
  );
}
