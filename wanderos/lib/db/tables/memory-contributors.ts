import { randomBytes } from "crypto";
import { queryAurora } from "@/lib/db/pool";

export type Consent = "public" | "private_only" | "withdrawn";

export type Contributor = {
  id: string;
  job_id: string;
  user_id: string | null;
  display_name: string;
  invite_token: string | null;
  consent: Consent;
  is_minor: boolean;
  guardian_for: string | null;
  removed_at: string | null;
  created_at: string;
};

export type Invite = {
  token: string;
  job_id: string;
  label: string | null;
  max_uses: number | null;
  used_count: number;
  revoked_at: string | null;
  expires_at: string | null;
  created_by: string;
  created_at: string;
};

/** Invite tokens are bearer credentials — CSPRNG, never derived from the job id. */
export async function createInvite(input: {
  jobId: string;
  createdBy: string;
  label?: string;
  maxUses?: number;
  expiresInDays?: number;
}): Promise<Invite> {
  const expires =
    input.expiresInDays != null
      ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString()
      : null;
  const rows = await queryAurora<Invite>(
    `insert into memory_invites (token, job_id, label, max_uses, expires_at, created_by)
     values ($1, $2, $3, $4, $5, $6) returning *`,
    [
      randomBytes(18).toString("base64url"),
      input.jobId,
      input.label ?? null,
      input.maxUses ?? null,
      expires,
      input.createdBy
    ]
  );
  return rows[0];
}

/**
 * Resolve an invite for joining. The use-count increment is part of the same
 * statement as the validity check, so two people redeeming the last use of an
 * invite at the same moment cannot both succeed.
 */
export async function redeemInvite(token: string): Promise<Invite | null> {
  const rows = await queryAurora<Invite>(
    `update memory_invites
        set used_count = used_count + 1
      where token = $1
        and revoked_at is null
        and (expires_at is null or expires_at > now())
        and (max_uses is null or used_count < max_uses)
      returning *`,
    [token]
  );
  return rows[0] ?? null;
}

export async function addContributor(input: {
  jobId: string;
  displayName: string;
  userId?: string | null;
  inviteToken?: string | null;
  consent?: Consent;
  isMinor?: boolean;
}): Promise<Contributor> {
  const rows = await queryAurora<Contributor>(
    `insert into memory_contributors (job_id, user_id, display_name, invite_token, consent, is_minor)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (job_id, display_name) do update
        set removed_at = null, invite_token = excluded.invite_token
     returning *`,
    [
      input.jobId,
      input.userId ?? null,
      input.displayName.trim().slice(0, 80),
      input.inviteToken ?? null,
      input.consent ?? "private_only", // default protects, never exposes
      input.isMinor ?? false
    ]
  );
  return rows[0];
}

export async function listContributors(jobId: string): Promise<Contributor[]> {
  return queryAurora<Contributor>(
    `select * from memory_contributors
      where job_id = $1 and removed_at is null
      order by created_at`,
    [jobId]
  );
}

export async function setConsent(
  jobId: string,
  contributorId: string,
  consent: Consent
): Promise<Contributor | null> {
  const rows = await queryAurora<Contributor>(
    `update memory_contributors set consent = $3
      where job_id = $1 and id = $2 returning *`,
    [jobId, contributorId, consent]
  );
  return rows[0] ?? null;
}

/**
 * Remove a contributor AND report which assets must now be excluded.
 *
 * Withdrawal has to be honoured retroactively — someone who leaves must be able
 * to take their photos with them, including out of a film already planned. The
 * caller re-plans without these keys.
 */
export async function removeContributor(
  jobId: string,
  contributorId: string
): Promise<{ removed: boolean; excludedKeys: string[] }> {
  const assets = await queryAurora<{ asset_key: string }>(
    `select asset_key from memory_asset_sources where job_id = $1 and contributor_id = $2`,
    [jobId, contributorId]
  );
  const rows = await queryAurora<Contributor>(
    `update memory_contributors set removed_at = now(), consent = 'withdrawn'
      where job_id = $1 and id = $2 and removed_at is null returning *`,
    [jobId, contributorId]
  );
  return { removed: rows.length > 0, excludedKeys: assets.map((a) => a.asset_key) };
}

/** Attribute an uploaded asset. sha256 is what lets two phones collapse to one photo. */
export async function attributeAsset(input: {
  jobId: string;
  assetKey: string;
  contributorId: string;
  sha256?: string;
}): Promise<void> {
  await queryAurora(
    `insert into memory_asset_sources (job_id, asset_key, contributor_id, sha256)
     values ($1, $2, $3, $4)
     on conflict (job_id, asset_key) do nothing`,
    [input.jobId, input.assetKey, input.contributorId, input.sha256 ?? null]
  );
}

/**
 * Assets usable for a given audience.
 *
 * A contributor set to private_only keeps their photos out of the public reel
 * but not out of the family film; withdrawn removes them from both. Filtering
 * here rather than at render time means a withdrawal takes effect on the next
 * render without any special-casing downstream.
 */
export async function assetsForAudience(
  jobId: string,
  audience: "public" | "private"
): Promise<string[]> {
  const allowed: Consent[] = audience === "public" ? ["public"] : ["public", "private_only"];
  const rows = await queryAurora<{ asset_key: string }>(
    `select s.asset_key
       from memory_asset_sources s
       join memory_contributors c on c.id = s.contributor_id
      where s.job_id = $1 and c.removed_at is null and c.consent = any($2)`,
    [jobId, allowed]
  );
  return rows.map((r) => r.asset_key);
}
