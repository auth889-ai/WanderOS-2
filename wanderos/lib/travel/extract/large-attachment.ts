/**
 * Large attachments — B2 for evidence, S3 as a scratch pad for Textract.
 *
 * Textract's asynchronous API reads its input from S3 using its own IAM role
 * inside AWS. It is not an S3 client pointed at an endpoint, so an
 * S3-compatible service cannot be substituted however compatible its API is:
 *
 *   StartDocumentAnalysis(Bucket="wanderos-media")
 *     -> InvalidS3ObjectException: Unable to get object metadata from S3
 *
 * That is a constraint, not a defect, and it suggests the right split rather
 * than forcing everything into one store:
 *
 *   B2  the durable original. Object Lock, provenance, cheap egress — this is
 *       the copy that must survive and be re-readable years later when an
 *       extraction is disputed.
 *   S3  a scratch copy that exists only while Textract reads it, then goes.
 *
 * The alternative — keeping evidence in S3 because Textract needs it there —
 * would put the permanent record in the more expensive store for the sake of a
 * few seconds of processing, and lose Object Lock in the process.
 *
 * **The staged copy is always deleted, including when extraction fails.**
 * A scratch bucket that silently accumulates travellers' booking documents is a
 * data-retention problem nobody notices until it matters.
 */

import {
  DeleteObjectCommand,
  GetBucketLocationCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import {
  GetDocumentAnalysisCommand,
  StartDocumentAnalysisCommand,
  TextractClient,
  type Block
} from "@aws-sdk/client-textract";

/** Textract asynchronous ceilings — an order of magnitude past the sync API. */
export const ASYNC_MAX_BYTES = 500 * 1024 * 1024;
export const ASYNC_MAX_PAGES = 3000;

export type LargeResult =
  | {
      ok: true;
      lines: Array<{ text: string; page: number; confidence: number }>;
      pairs: Array<{ key: string; value: string; page: number; confidence: number }>;
      pages: number;
      /** The B2 key — the durable original, not the scratch copy. */
      evidenceRef: string;
      jobId: string;
    }
  | { ok: false; reason: string; tooLarge: boolean; sizeBytes: number | null };

function stagingBucket(): string {
  return (
    process.env.AWS_STAGING_BUCKET ?? "wanderos-bedrock-output-915644996102"
  );
}

let cachedRegion: string | null = null;

/**
 * The staging bucket's own region.
 *
 * Textract's async API and the bucket it reads must be in the SAME region, and
 * an S3 bucket in the wrong one fails with "must be addressed using the
 * specified endpoint" — a message that says nothing about regions. Asking S3
 * where the bucket lives is more reliable than assuming AWS_REGION, which is
 * frequently not where the bucket was created.
 */
async function bucketRegion(fallback: string): Promise<string> {
  if (cachedRegion) return cachedRegion;
  try {
    const probe = new S3Client({ region: fallback });
    const location = await probe.send(
      new GetBucketLocationCommand({ Bucket: stagingBucket() })
    );
    // us-east-1 is reported as null by the API, for historical reasons.
    cachedRegion = location.LocationConstraint || "us-east-1";
  } catch {
    cachedRegion = fallback;
  }
  return cachedRegion;
}

/**
 * Read a document too large for the synchronous API.
 *
 * `evidenceRef` is where the durable original lives in B2. It is carried
 * through untouched so every extracted field still points at the copy that will
 * outlive this call.
 */
export async function readLargeAttachment(
  bytes: Uint8Array,
  contentType: string,
  evidenceRef: string,
  options: { region?: string; pollMs?: number; timeoutMs?: number } = {}
): Promise<LargeResult> {
  if (bytes.byteLength > ASYNC_MAX_BYTES) {
    return {
      ok: false,
      reason: `Attachment is ${(bytes.byteLength / 1_048_576).toFixed(0)} MB, over Textract's ${ASYNC_MAX_BYTES / 1_048_576} MB asynchronous ceiling.`,
      tooLarge: true,
      sizeBytes: bytes.byteLength
    };
  }

  const region =
    options.region ?? (await bucketRegion(process.env.AWS_REGION ?? "us-east-1"));
  const s3 = new S3Client({ region });
  const textract = new TextractClient({ region });
  const bucket = stagingBucket();
  // A key that says what it is and when, so anything left behind by a crash is
  // identifiable rather than mysterious.
  const key = `textract-staging/${Date.now()}-${evidenceRef.replace(/[^a-z0-9.-]/gi, "_")}`;

  let staged = false;
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType
      })
    );
    staged = true;

    const started = await textract.send(
      new StartDocumentAnalysisCommand({
        DocumentLocation: { S3Object: { Bucket: bucket, Name: key } },
        FeatureTypes: ["FORMS"]
      })
    );
    const jobId = started.JobId ?? "";
    if (!jobId) {
      return { ok: false, reason: "Textract returned no job id", tooLarge: false, sizeBytes: bytes.byteLength };
    }

    const pollMs = options.pollMs ?? 3000;
    const deadline = Date.now() + (options.timeoutMs ?? 300_000);

    let blocks: Block[] = [];
    let nextToken: string | undefined;
    let status = "IN_PROGRESS";

    while (Date.now() < deadline) {
      const page = await textract.send(
        new GetDocumentAnalysisCommand({ JobId: jobId, NextToken: nextToken })
      );
      status = page.JobStatus ?? "IN_PROGRESS";

      if (status === "SUCCEEDED") {
        blocks = blocks.concat(page.Blocks ?? []);
        // A long document arrives in pages; stopping at the first would return
        // a confident partial read of a complete document.
        if (page.NextToken) {
          nextToken = page.NextToken;
          continue;
        }
        break;
      }
      if (status === "FAILED") {
        return {
          ok: false,
          reason: `Textract job failed: ${page.StatusMessage ?? "no detail"}`,
          tooLarge: false,
          sizeBytes: bytes.byteLength
        };
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    if (status !== "SUCCEEDED") {
      return {
        ok: false,
        reason: `Textract did not finish within ${(options.timeoutMs ?? 300_000) / 1000}s (last status ${status})`,
        tooLarge: false,
        sizeBytes: bytes.byteLength
      };
    }

    const byId = new Map(blocks.map((b) => [b.Id ?? "", b]));
    const wordsOf = (block: Block): string =>
      (block.Relationships ?? [])
        .filter((r) => r.Type === "CHILD")
        .flatMap((r) => r.Ids ?? [])
        .map((id) => byId.get(id))
        .filter((b) => b?.BlockType === "WORD")
        .map((b) => b?.Text ?? "")
        .join(" ");

    const lines = blocks
      .filter((b) => b.BlockType === "LINE")
      .map((b) => ({
        text: b.Text ?? "",
        page: b.Page ?? 1,
        confidence: Math.round(b.Confidence ?? 0) / 100
      }));

    const pairs: Array<{ key: string; value: string; page: number; confidence: number }> = [];
    for (const block of blocks) {
      if (block.BlockType !== "KEY_VALUE_SET") continue;
      if (!(block.EntityTypes ?? []).includes("KEY")) continue;
      const label = wordsOf(block).replace(/:$/, "").trim();
      if (!label) continue;
      const value = (block.Relationships ?? [])
        .filter((r) => r.Type === "VALUE")
        .flatMap((r) => r.Ids ?? [])
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((b) => wordsOf(b as Block))
        .join(" ")
        .trim();
      pairs.push({
        key: label,
        value,
        page: block.Page ?? 1,
        confidence: Math.round(block.Confidence ?? 0) / 100
      });
    }

    return {
      ok: true,
      lines,
      pairs,
      pages: Math.max(1, ...lines.map((l) => l.page)),
      evidenceRef,
      jobId
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "large attachment read failed",
      tooLarge: false,
      sizeBytes: bytes.byteLength
    };
  } finally {
    // Always, including on failure. A scratch bucket quietly accumulating
    // travellers' booking documents is a retention problem nobody notices.
    if (staged) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch {
        // Logged rather than thrown: failing to tidy up must not turn a
        // successful extraction into an error the caller has to handle.
        console.warn(`textract staging cleanup failed for ${key}`);
      }
    }
  }
}

/**
 * Why B2 cannot be the Textract source, in one place so nobody re-litigates it.
 */
export const TEXTRACT_SOURCE_CONSTRAINT = {
  question: "Can Backblaze B2 serve Textract's asynchronous API directly?",
  answer: "No.",
  because:
    "StartDocumentAnalysis takes an S3Object and Textract reads it inside AWS " +
    "with its own IAM role. It is not an S3 client pointed at a configurable " +
    "endpoint, so S3-compatible APIs cannot be substituted. Verified: passing a " +
    "B2 bucket name returns InvalidS3ObjectException.",
  approach:
    "B2 holds the durable original — Object Lock, provenance, cheap egress. S3 " +
    "holds a scratch copy for the seconds Textract needs it, always deleted " +
    "afterwards including on failure."
} as const;
