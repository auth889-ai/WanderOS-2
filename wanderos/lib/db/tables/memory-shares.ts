import { randomBytes } from "crypto";
import { queryAurora } from "@/lib/db/pool";

export type ShareRow = {
  token: string;
  job_id: string;
  audience: "public" | "private";
  revoked_at: string | null;
  expires_at: string | null;
  view_count: number;
  created_by: string | null;
  created_at: string;
};

/**
 * A share token is a bearer credential — anyone holding the link can view — so
 * it is generated from a CSPRNG, not from the job id or a timestamp. 24 bytes
 * base64url is ~192 bits: not guessable, still short enough to paste.
 */
function newToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function createShare(input: {
  jobId: string;
  audience: "public" | "private";
  createdBy: string;
  expiresInDays?: number;
}): Promise<ShareRow> {
  const expires =
    input.expiresInDays != null
      ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString()
      : null;
  const rows = await queryAurora<ShareRow>(
    `insert into memory_shares (token, job_id, audience, expires_at, created_by)
     values ($1, $2, $3, $4, $5) returning *`,
    [newToken(), input.jobId, input.audience, expires, input.createdBy]
  );
  return rows[0];
}

/**
 * Resolve a token for viewing. Returns null for revoked or expired links so the
 * caller cannot accidentally treat a dead link as valid — the checks live here
 * rather than in each page.
 */
export async function resolveShare(token: string): Promise<ShareRow | null> {
  const rows = await queryAurora<ShareRow>(
    `update memory_shares
        set view_count = view_count + 1
      where token = $1
        and revoked_at is null
        and (expires_at is null or expires_at > now())
      returning *`,
    [token]
  );
  return rows[0] ?? null;
}

export async function listSharesForJob(jobId: string): Promise<ShareRow[]> {
  return queryAurora<ShareRow>(
    `select * from memory_shares where job_id = $1 order by created_at desc`,
    [jobId]
  );
}

/** Revoke rather than delete, so a leaked link stays dead and auditable. */
export async function revokeShare(token: string, ownerId: string): Promise<boolean> {
  const rows = await queryAurora<ShareRow>(
    `update memory_shares s set revoked_at = now()
       from memory_jobs j
      where s.token = $1 and s.job_id = j.id and j.owner_id = $2
        and s.revoked_at is null
      returning s.*`,
    [token, ownerId]
  );
  return rows.length > 0;
}
