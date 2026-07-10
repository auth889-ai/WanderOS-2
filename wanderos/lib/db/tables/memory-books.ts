import { queryAurora } from "../pool";
import type { MemoryBookDoc, MemoryBookRow, MemoryBookStatus } from "@/lib/memory/types";

/**
 * memory-books repo — the ONLY module that touches memory_books / memory_book_versions.
 * Shared types/constants live in @/lib/memory/types (pg-free, client-safe); re-exported here for server callers.
 */
export type { Layer, Page, Spread, MemoryBookDoc, MemoryBookRow, MemoryBookStatus, LayerKind } from "@/lib/memory/types";
export { PAGE_W, PAGE_H } from "@/lib/memory/types";

export async function createBook(travelerId: string, input: { tripId?: string | null; title?: string }): Promise<MemoryBookRow> {
  const rows = await queryAurora<MemoryBookRow>(
    `insert into memory_books (traveler_id, trip_id, title)
     values ($1, $2, coalesce($3, 'My Memory Book'))
     returning *`,
    [travelerId, input.tripId ?? null, input.title ?? null]
  );
  return rows[0];
}

export async function getBook(id: string): Promise<MemoryBookRow | null> {
  const rows = await queryAurora<MemoryBookRow>(`select * from memory_books where id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listForTraveler(travelerId: string): Promise<MemoryBookRow[]> {
  return queryAurora<MemoryBookRow>(
    `select * from memory_books where traveler_id = $1 order by created_at desc`,
    [travelerId]
  );
}

export async function updateDoc(id: string, doc: MemoryBookDoc): Promise<MemoryBookRow | null> {
  const rows = await queryAurora<MemoryBookRow>(
    `update memory_books set doc = $2::jsonb, updated_at = now() where id = $1 returning *`,
    [id, JSON.stringify(doc)]
  );
  return rows[0] ?? null;
}

export async function setStatus(id: string, status: MemoryBookStatus): Promise<void> {
  await queryAurora(`update memory_books set status = $2, updated_at = now() where id = $1`, [id, status]);
}

export async function setAgentJob(id: string, agentJobId: string): Promise<void> {
  await queryAurora(`update memory_books set agent_job_id = $2, updated_at = now() where id = $1`, [id, agentJobId]);
}

export async function setCover(id: string, coverUrl: string, theme?: string): Promise<void> {
  await queryAurora(
    `update memory_books set cover_url = $2, theme = coalesce($3, theme), updated_at = now() where id = $1`,
    [id, coverUrl, theme ?? null]
  );
}

/** Save an explicit version snapshot (auto-incrementing per book). Returns the new version number. */
export async function saveVersion(id: string, doc: MemoryBookDoc): Promise<number> {
  const rows = await queryAurora<{ version: number }>(
    `insert into memory_book_versions (memory_book_id, version, doc)
     select $1, coalesce(max(version), 0) + 1, $2::jsonb from memory_book_versions where memory_book_id = $1
     returning version`,
    [id, JSON.stringify(doc)]
  );
  return rows[0]?.version ?? 1;
}
