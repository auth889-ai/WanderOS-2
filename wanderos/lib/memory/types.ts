/**
 * Memory Book shared types + constants — NO server imports (safe for client components).
 * The whole book is one `doc` (spreads → pages → layers) in fixed page coords.
 */
export const PAGE_W = 1000;
export const PAGE_H = 1800;

export type LayerKind = "photo" | "text" | "sticker" | "decoration";

export type Layer = {
  id: string;
  kind: LayerKind;
  x: number; y: number; w: number; h: number;
  rotation: number;
  z?: number;
  src?: string;
  text?: string;
  role?: string;
  variant?: string;
  props?: Record<string, unknown>;
  locked?: boolean;
  source?: "post" | "upload" | "user";
};

export type Page = { layers: Layer[] };
export type Spread = { id: string; layout?: string; theme?: string; leftPage: Page; rightPage: Page };
export type MemoryBookDoc = { title?: string; theme?: string; spreads: Spread[] };

export type MemoryBookStatus = "building" | "ready" | "failed";

export type MemoryBookRow = {
  id: string;
  traveler_id: string;
  trip_id: string | null;
  title: string;
  cover_url: string | null;
  theme: string;
  status: MemoryBookStatus;
  doc: MemoryBookDoc;
  agent_job_id: string | null;
  created_at: string;
  updated_at: string;
};
