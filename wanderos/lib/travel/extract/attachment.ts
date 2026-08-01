/**
 * Tier 3 — attachments, via AWS Textract.
 *
 * Most airlines attach the real detail as a PDF and put "your itinerary is
 * attached" in the body. Tiers 1 and 2 see nothing; the model tier reads only
 * the covering sentence. This is where the booking actually lives.
 *
 * **Hard limits, stated rather than discovered in production:**
 *
 *   Lambda Function URL request   6 MB   (base64-inflated, so ~4.4 MB of file)
 *   Textract synchronous document 5 MB   and 1 page for PDF
 *   Textract async (S3-backed)    500 MB and 3000 pages
 *
 * The Function URL ceiling is the binding one and it is not configurable. An
 * oversized attachment therefore has a defined failure state — `tooLarge` with
 * the actual size — instead of a truncated read that produces a confident,
 * wrong itinerary from page one of a twelve-page document.
 *
 * Every field keeps its page number and the source line it came from, because
 * an extraction nobody can trace back to the document is one nobody can correct.
 */

import {
  AnalyzeDocumentCommand,
  TextractClient,
  type Block
} from "@aws-sdk/client-textract";

import { hasTimezone, type ExtractedSegment } from "./structured";

/** Lambda Function URL payload ceiling. Not configurable. */
export const FUNCTION_URL_LIMIT_BYTES = 6 * 1024 * 1024;
/** Textract synchronous AnalyzeDocument ceiling. */
export const TEXTRACT_SYNC_LIMIT_BYTES = 5 * 1024 * 1024;
/** base64 inflates by 4/3, so this is the real file size a webhook can carry. */
export const MAX_ATTACHMENT_BYTES = Math.floor(FUNCTION_URL_LIMIT_BYTES * 0.75) - 64 * 1024;

const SUPPORTED = new Set(["application/pdf", "image/jpeg", "image/png", "image/tiff"]);

export type AttachmentResult =
  | {
      ok: true;
      lines: Array<{ text: string; page: number; confidence: number }>;
      pairs: Array<{ key: string; value: string; page: number; confidence: number }>;
      pages: number;
      evidenceRef: string;
    }
  | {
      ok: false;
      reason: string;
      /** True when the file exceeded a documented ceiling rather than failing
       *  for an unknown cause — the caller can tell the user something useful. */
      tooLarge: boolean;
      sizeBytes: number | null;
      limitBytes: number | null;
    };

/**
 * Read one attachment.
 *
 * `evidenceRef` is the caller's pointer to the stored original (an S3 or B2
 * key). It is threaded through so every extracted field can be shown beside
 * the document it came from during review.
 */
export async function readAttachment(
  bytes: Uint8Array,
  contentType: string,
  evidenceRef: string,
  options: { region?: string } = {}
): Promise<AttachmentResult> {
  if (!SUPPORTED.has(contentType)) {
    return {
      ok: false,
      reason: `Unsupported attachment type "${contentType}". Textract reads PDF, JPEG, PNG and TIFF.`,
      tooLarge: false,
      sizeBytes: bytes.byteLength,
      limitBytes: null
    };
  }

  if (bytes.byteLength > TEXTRACT_SYNC_LIMIT_BYTES) {
    // A defined failure, not a truncated read. Reading page one of a long
    // document and reporting it as the whole booking is the dangerous outcome.
    return {
      ok: false,
      reason:
        `Attachment is ${(bytes.byteLength / 1_048_576).toFixed(1)} MB, over Textract's ` +
        `${TEXTRACT_SYNC_LIMIT_BYTES / 1_048_576} MB synchronous limit. ` +
        `Large documents need the asynchronous S3-backed API, which is not wired up.`,
      tooLarge: true,
      sizeBytes: bytes.byteLength,
      limitBytes: TEXTRACT_SYNC_LIMIT_BYTES
    };
  }

  try {
    const client = new TextractClient({
      region: options.region ?? process.env.AWS_REGION ?? "us-east-1"
    });
    const response = await client.send(
      new AnalyzeDocumentCommand({
        Document: { Bytes: bytes },
        // FORMS is what turns "Check-in:" -> "4 August" into a pair. Rebuilding
        // that from raw lines is fragile; Textract already knows they belong
        // together.
        FeatureTypes: ["FORMS"]
      })
    );

    const blocks = response.Blocks ?? [];
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
        confidence: Math.round((b.Confidence ?? 0)) / 100
      }));

    const pairs: AttachmentResult extends { ok: true } ? never : Array<{
      key: string;
      value: string;
      page: number;
      confidence: number;
    }> = [];

    for (const block of blocks) {
      if (block.BlockType !== "KEY_VALUE_SET") continue;
      if (!(block.EntityTypes ?? []).includes("KEY")) continue;
      const key = wordsOf(block).replace(/:$/, "").trim();
      if (!key) continue;
      const value = (block.Relationships ?? [])
        .filter((r) => r.Type === "VALUE")
        .flatMap((r) => r.Ids ?? [])
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((b) => wordsOf(b as Block))
        .join(" ")
        .trim();
      pairs.push({
        key,
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
      evidenceRef
    };
  } catch (error) {
    // Textract being unreachable and the document being unreadable are
    // different failures; only the second is about the attachment.
    const message = error instanceof Error ? error.message : "Textract failed";
    return {
      ok: false,
      reason: `Textract error: ${message}`,
      tooLarge: false,
      sizeBytes: bytes.byteLength,
      limitBytes: null
    };
  }
}

/**
 * Turn a Textract read into segments — carrying page and source text.
 *
 * The provenance is the point. During review a traveller sees "check-in
 * 2026-08-04" beside the line "Check-in: Tuesday 4 August 2026" on page 1, and
 * can tell at a glance whether the parser or the document is wrong.
 */
export function segmentsFromAttachment(
  result: Extract<AttachmentResult, { ok: true }>
): Array<ExtractedSegment & { evidence: Array<{ field: string; text: string; page: number }> }> {
  // Prefer a match that actually HAS a value. Textract sometimes pairs a label
  // with an empty string and attaches the real value to a neighbouring
  // mis-detected key — taking the first match regardless returns a confident
  // empty reference, which reads as "this booking has no reference" rather than
  // "we misread it".
  const find = (...names: string[]) => {
    const matches = result.pairs.filter((p) =>
      names.some((n) => p.key.toLowerCase().includes(n))
    );
    return matches.find((p) => p.value.trim().length > 0) ?? matches[0];
  };

  /** A confirmation reference is a run of 5+ alphanumerics. When the labelled
   *  pair is empty, recover it from the raw lines rather than reporting none. */
  const referenceFromLines = (): { value: string; page: number } | undefined => {
    for (const line of result.lines) {
      // Must contain a digit: "confirmation number" would otherwise match the
      // literal word "number" and report it as the booking reference.
      const m = /(?:confirmation|booking|reference|pnr)\s*(?:number|no\.?|ref)?\s*[:#-]?\s*([A-Z0-9-]*\d[A-Z0-9-]{4,})/i.exec(line.text);
      if (m) return { value: m[1], page: line.page };
    }
    return undefined;
  };

  const checkIn = find("check-in", "check in", "arrival", "departure date");
  const checkOut = find("check-out", "check out", "return");
  let reference = find("confirmation", "booking reference", "reference", "pnr");
  if (!reference?.value?.trim()) {
    const recovered = referenceFromLines();
    if (recovered) {
      reference = { key: "confirmation number", value: recovered.value,
                    page: recovered.page, confidence: 0.75 };
    }
  }
  const flight = find("flight");
  const total = find("total", "amount", "price");

  if (!checkIn && !reference && !flight) return [];

  const evidence: Array<{ field: string; text: string; page: number }> = [];
  const note = (field: string, pair?: { key: string; value: string; page: number }) => {
    if (pair) evidence.push({ field, text: `${pair.key}: ${pair.value}`, page: pair.page });
  };
  note("departsAt", checkIn);
  note("arrivesAt", checkOut);
  note("reference", reference);
  note("number", flight);
  note("amount", total);

  // Confidence is the WEAKEST field's, not an average. One badly-OCR'd date
  // makes the whole booking unsafe to act on, and averaging would hide it.
  const used = [checkIn, checkOut, reference, flight].filter(Boolean) as Array<{
    confidence: number;
  }>;
  const weakest = used.length ? Math.min(...used.map((p) => p.confidence)) : 0.5;

  return [
    {
      kind: flight ? "flight" : "lodging",
      reference: reference?.value ?? null,
      carrier: null,
      number: flight?.value ?? null,
      from: null,
      to: null,
      departsAt: checkIn?.value ?? null,
      arrivesAt: checkOut?.value ?? null,
      // Textract returns the text as printed; a document rarely states a zone.
      timezoneUnknown: !hasTimezone(checkIn?.value ?? null),
      passenger: null,
      seat: null,
      tier: "ocr",
      // Capped below the deterministic tiers: OCR of a printed date is a good
      // read of what was printed, not proof the printing was right.
      confidence: Math.min(0.8, weakest),
      evidence
    }
  ];
}
