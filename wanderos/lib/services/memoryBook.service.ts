import { randomUUID } from "crypto";
import { enqueueJob } from "@/lib/queue/queues";
import * as repo from "@/lib/db/tables/memory-books";
import type { MemoryBookDoc, MemoryBookRow } from "@/lib/db/tables/memory-books";

/**
 * memoryBook.service — owner-scoped orchestration over the memory-books repo + the memory_build job.
 * (Cinematic replay belongs to the Memory Jar / fal pipeline and is intentionally not here.)
 */

/** Create the book row + enqueue the durable build job. RBAC: caller must be the traveler.
 *  `photos` (optional) = manually uploaded photo URLs → the book is built from THOSE instead of the traveler's posts. */
export async function startBuild(
  travelerId: string,
  input: { tripId?: string | null; title?: string; photos?: { url: string; description?: string }[] }
): Promise<{ bookId: string; jobId: string }> {
  const book = await repo.createBook(travelerId, { tripId: input.tripId ?? null, title: input.title });
  const job = await enqueueJob({
    type: "memory_build",
    userId: travelerId,
    idempotencyKey: `memory-build-${book.id}-${randomUUID()}`,
    input: { bookId: book.id, travelerId, tripId: input.tripId ?? null, title: input.title ?? null, photos: input.photos ?? null }
  });
  await repo.setAgentJob(book.id, job.id);
  return { bookId: book.id, jobId: job.id };
}

/** Owner-only read. */
export async function getBook(travelerId: string, id: string): Promise<MemoryBookRow | null> {
  const book = await repo.getBook(id);
  if (!book || book.traveler_id !== travelerId) return null;
  return book;
}

export async function listBooks(travelerId: string): Promise<MemoryBookRow[]> {
  return repo.listForTraveler(travelerId);
}

/** Owner-only autosave (debounced from the editor). */
export async function autosaveDoc(travelerId: string, id: string, doc: MemoryBookDoc): Promise<MemoryBookRow | null> {
  const book = await repo.getBook(id);
  if (!book || book.traveler_id !== travelerId) return null;
  return repo.updateDoc(id, doc);
}

/** Owner-only explicit "Save" → an immutable version snapshot. Persists `doc` first if provided. */
export async function snapshot(travelerId: string, id: string, doc?: MemoryBookDoc): Promise<{ version: number } | null> {
  const book = await repo.getBook(id);
  if (!book || book.traveler_id !== travelerId) return null;
  const current = doc ?? book.doc;
  if (doc) await repo.updateDoc(id, doc);
  const version = await repo.saveVersion(id, current);
  return { version };
}
