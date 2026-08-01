/**
 * The ingestion pipeline — email in, reviewable trip out.
 *
 * This is the piece that makes the four tiers a feature rather than four
 * modules. It runs them in strength order, merges what they agree on,
 * reconciles the result against what the trip already knows, and stops at
 * review rather than writing.
 *
 *   receive -> extract (1..4) -> reconcile -> [REVIEW] -> commit -> outbox
 *
 * **Nothing is committed here.** The pipeline's output is a proposal. Writing
 * happens only after a human approves, through `commitExtraction`, in one
 * transaction. That separation is the whole safety property: an OCR misread of
 * a check-in time would otherwise poison every cascade prediction downstream
 * with full confidence.
 */

import {
  readAttachment,
  segmentsFromAttachment,
  MAX_ATTACHMENT_BYTES
} from "./attachment";
import { extractWithModel, extractTerms } from "./model";
import {
  reconcile,
  type ExistingCommitment,
  type Reconciliation
} from "./reconcile";
import {
  extractBoardingPass,
  extractJsonLd,
  mergeSegments,
  type ExtractedSegment
} from "./structured";

export type InboundEmail = {
  messageId: string;
  from?: string;
  subject?: string;
  htmlBody?: string;
  textBody?: string;
  attachments?: Array<{ name: string; contentType: string; bytes: Uint8Array }>;
};

export type Proposal = {
  segment: ExtractedSegment;
  reconciliation: Reconciliation;
  evidence: Array<{ field: string; text: string; page?: number | null; ref?: string }>;
  terms: {
    refundable: boolean | null;
    amount: number | null;
    currency: string | null;
    hardDeadline: string | null;
  };
};

export type PipelineResult = {
  messageId: string;
  tiersRun: string[];
  tiersFound: Record<string, number>;
  proposals: Proposal[];
  attachmentFailures: Array<{ name: string; reason: string; tooLarge: boolean }>;
  /** True when at least one proposal needs a human before it can be committed. */
  needsReview: boolean;
  summary: string;
};

export async function runPipeline(
  email: InboundEmail,
  existing: ExistingCommitment[],
  options: { now?: Date } = {}
): Promise<PipelineResult> {
  const tiersRun: string[] = [];
  const found: Record<string, number> = {};
  const attachmentFailures: PipelineResult["attachmentFailures"] = [];
  const evidence: Proposal["evidence"] = [];

  const html = email.htmlBody ?? "";
  const text = email.textBody ?? "";
  const combined = `${text}\n${html.replace(/<[^>]+>/g, " ")}`.trim();

  // ── Tier 1: schema.org JSON-LD ──────────────────────────────────────────
  tiersRun.push("json-ld");
  const jsonLd = html ? extractJsonLd(html) : [];
  found["json-ld"] = jsonLd.length;

  // ── Tier 2: IATA boarding-pass barcode ──────────────────────────────────
  tiersRun.push("barcode");
  const barcodes: ExtractedSegment[] = [];
  // A pass can appear as a bare line anywhere in the body.
  for (const line of combined.split(/\r?\n/)) {
    const pass = extractBoardingPass(line, options.now);
    if (pass) barcodes.push(pass);
  }
  found["barcode"] = barcodes.length;

  // ── Tier 3: attachments via Textract ────────────────────────────────────
  tiersRun.push("ocr");
  const ocr: ExtractedSegment[] = [];
  for (const attachment of email.attachments ?? []) {
    if (attachment.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      // Stated ceiling, not a truncated read. A partial parse of a long
      // document reads as a complete booking and is worse than a refusal.
      attachmentFailures.push({
        name: attachment.name,
        reason: `${(attachment.bytes.byteLength / 1_048_576).toFixed(1)} MB exceeds the ${(MAX_ATTACHMENT_BYTES / 1_048_576).toFixed(2)} MB a Lambda Function URL can carry`,
        tooLarge: true
      });
      continue;
    }
    const read = await readAttachment(
      attachment.bytes,
      attachment.contentType,
      `inbound/${email.messageId}/${attachment.name}`
    );
    if (!read.ok) {
      attachmentFailures.push({
        name: attachment.name,
        reason: read.reason,
        tooLarge: read.tooLarge
      });
      continue;
    }
    for (const segment of segmentsFromAttachment(read)) {
      const { evidence: fieldEvidence, ...rest } = segment;
      ocr.push(rest);
      for (const item of fieldEvidence) {
        evidence.push({ ...item, ref: read.evidenceRef });
      }
    }
  }
  found["ocr"] = ocr.length;

  // ── Tier 4: the model, only if the earlier tiers found nothing ──────────
  //
  // Running it anyway would spend money and latency to produce a weaker read of
  // something already known exactly.
  let model: ExtractedSegment[] = [];
  const deterministicCount = jsonLd.length + barcodes.length + ocr.length;
  if (deterministicCount === 0 && combined.length > 30) {
    tiersRun.push("model");
    const result = await extractWithModel(combined, { now: options.now });
    model = result.segments;
    found["model"] = model.length;
    if (result.failed) {
      attachmentFailures.push({
        name: "(email body)",
        reason: result.failed,
        tooLarge: false
      });
    }
  }

  // Commercial terms come from the model regardless of tier, because no
  // structured format carries refundability or a reception closing time — and
  // those are exactly what the cascade engine needs.
  const terms =
    combined.length > 30
      ? await extractTerms(combined, options.now)
      : { refundable: null, amount: null, currency: null, hardDeadline: null };

  const merged = mergeSegments(jsonLd, barcodes, ocr, model);

  const proposals: Proposal[] = merged.map((segment) => ({
    segment,
    reconciliation: reconcile(segment, existing, { rawText: combined, terms }),
    evidence: evidence.filter(() => true),
    terms
  }));

  const needsReview = proposals.some((p) => p.reconciliation.requiresReview);

  return {
    messageId: email.messageId,
    tiersRun,
    tiersFound: found,
    proposals,
    attachmentFailures,
    needsReview,
    summary: describe(proposals, attachmentFailures, found)
  };
}

function describe(
  proposals: Proposal[],
  failures: PipelineResult["attachmentFailures"],
  found: Record<string, number>
): string {
  if (!proposals.length) {
    return failures.length
      ? `No booking could be read. ${failures[0].reason}`
      : "No booking found in this message.";
  }
  const tier = proposals[0].segment.tier;
  const how =
    tier === "json-ld"
      ? "read exactly from the sender's own structured data"
      : tier === "barcode"
        ? "read from the boarding pass barcode"
        : tier === "ocr"
          ? "read from the attachment"
          : "inferred from the wording, so worth checking";

  const review = proposals.filter((p) => p.reconciliation.requiresReview).length;
  return (
    `${proposals.length} booking(s) ${how}.` +
    (review ? ` ${review} need(s) review before committing.` : " Nothing needs review.") +
    (failures.length ? ` ${failures.length} attachment(s) could not be read.` : "")
  );
}
