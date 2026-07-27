import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * The only module that touches Backblaze B2. B2 is the system of record for every
 * Autopilot media asset — originals, generated clips, storyboards, approvals,
 * manifests, critic verdicts, logs, and finals. Postgres holds pointers only.
 *
 * Buckets (created in the B2 console, Phase 0):
 *   B2_BUCKET_MEDIA        trips/{tripId}/...           day-to-day assets
 *   B2_BUCKET_PROVENANCE   manifests/{runId}.json       Object Lock COMPLIANCE — tamper-evident
 *   B2_BUCKET_INTERMEDIATE scratch renders              3-day lifecycle rule
 *   B2_BUCKET_LOGS         audit-logs/...               tracer + cost telemetry
 */

const REGION = process.env.B2_REGION || "us-west-004";

let _client: S3Client | null = null;
function client(): S3Client {
  if (!_client) {
    const keyId = process.env.B2_KEY_ID;
    const appKey = process.env.B2_APPLICATION_KEY;
    if (!keyId || !appKey) throw new B2NotConfiguredError();
    _client = new S3Client({
      region: REGION,
      endpoint: `https://s3.${REGION}.backblazeb2.com`,
      forcePathStyle: true,
      credentials: { accessKeyId: keyId, secretAccessKey: appKey }
    });
  }
  return _client;
}

export class B2NotConfiguredError extends Error {
  constructor() {
    super("B2_KEY_ID / B2_APPLICATION_KEY missing — set them in .env (see docs/hackathon/DETAILED_BUILD_SPEC.md Phase 0)");
  }
}

export const MEDIA_BUCKET = () => process.env.B2_BUCKET_MEDIA || "wanderos-media";
export const PROVENANCE_BUCKET = () => process.env.B2_BUCKET_PROVENANCE || "wanderos-provenance";
export const LOGS_BUCKET = () => process.env.B2_BUCKET_LOGS || "wanderos-logs";

/** Canonical folder set under trips/{tripId}/ — mirrors the hackathon B2 layout. */
export type TripFolder =
  | "originals"
  | "processed"
  | "generated/images"
  | "generated/videos"
  | "audio"
  | "subtitles"
  | "storyboards"
  | "approvals"
  | "manifests"
  | "critic-results"
  | "logs"
  | "versions"
  | "final";

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

export function tripKey(tripId: string, folder: TripFolder, filename: string): string {
  if (!SAFE_SEGMENT.test(tripId)) throw new Error(`unsafe tripId segment: ${tripId}`);
  if (!SAFE_SEGMENT.test(filename)) throw new Error(`unsafe filename segment: ${filename}`);
  return `trips/${tripId}/${folder}/${filename}`;
}

/** Presigned browser PUT — 15 min, content-type pinned so the signature locks it. */
export async function presignUpload(key: string, contentType: string, bucket = MEDIA_BUCKET()): Promise<string> {
  return getSignedUrl(client(), new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), {
    expiresIn: 900
  });
}

/** Presigned GET — ALWAYS generated at click/render time, never stored (judge-proofing rule). */
export async function presignDownload(key: string, bucket = MEDIA_BUCKET(), expiresIn = 600): Promise<string> {
  return getSignedUrl(client(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}

export async function objectExists(key: string, bucket = MEDIA_BUCKET()): Promise<boolean> {
  try {
    await client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    // Only "not found" means false — auth failures, outages, and rate limits must
    // surface, not masquerade as a missing object (review finding).
    const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    const name = (error as Error)?.name;
    if (status === 404 || name === "NotFound" || name === "NoSuchKey") return false;
    throw error;
  }
}

/** Server-side JSON write (approvals, storyboard versions, cost summaries). */
export async function putJson(key: string, value: unknown, bucket = MEDIA_BUCKET()): Promise<void> {
  await client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(value, null, 2),
      ContentType: "application/json"
    })
  );
}

export function isB2Configured(): boolean {
  return Boolean(process.env.B2_KEY_ID && process.env.B2_APPLICATION_KEY);
}
