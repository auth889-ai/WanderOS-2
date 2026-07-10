import { queryAurora } from "@/lib/db/pool";

/** Repository for listing_videos (the render manifest + result). Only this module touches the table. */
export interface ListingVideoRow {
  id: string;
  listing_id: string;
  host_id: string | null;
  type: "tour" | "reel";
  mode: string;
  resolution: string;
  status: string; // queued|planning|narrating|rendering|composing|publishing|ready|failed|cancelled
  brief: Record<string, unknown>;
  manifest: Record<string, unknown>;
  url: string | null;
  thumbnail_url: string | null;
  duration_sec: number | null;
  cost_cents: number;
  agent_job_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export async function createVideo(input: {
  listingId: string;
  hostId: string;
  type: "tour" | "reel";
  mode: string;
  resolution: string;
  brief: Record<string, unknown>;
  agentJobId?: string;
}): Promise<ListingVideoRow> {
  const [row] = await queryAurora<ListingVideoRow>(
    `insert into listing_videos (listing_id, host_id, type, mode, resolution, brief, agent_job_id, status)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7,'queued') returning *`,
    [input.listingId, input.hostId, input.type, input.mode, input.resolution, JSON.stringify(input.brief), input.agentJobId ?? null]
  );
  return row;
}

export async function setVideoStatus(id: string, status: string, error?: string): Promise<void> {
  await queryAurora(`update listing_videos set status=$2, error=$3, updated_at=now() where id=$1`, [id, status, error ?? null]);
}

export async function setVideoReady(id: string, r: { url: string; thumbnailUrl: string; durationSec: number; manifest: Record<string, unknown>; costCents: number }): Promise<void> {
  await queryAurora(
    `update listing_videos set status='ready', url=$2, thumbnail_url=$3, duration_sec=$4, manifest=$5::jsonb, cost_cents=$6, updated_at=now() where id=$1`,
    [id, r.url, r.thumbnailUrl, r.durationSec, JSON.stringify(r.manifest), r.costCents]
  );
}

export async function getVideo(id: string): Promise<ListingVideoRow | null> {
  const [row] = await queryAurora<ListingVideoRow>(`select * from listing_videos where id=$1`, [id]);
  return row ?? null;
}

export async function listVideosForListing(listingId: string): Promise<ListingVideoRow[]> {
  return queryAurora<ListingVideoRow>(`select * from listing_videos where listing_id=$1 order by created_at desc`, [listingId]);
}
