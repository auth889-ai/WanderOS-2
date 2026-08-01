import { getPool, queryAurora } from "../pool";

/**
 * ingestion.repo — the ONLY module that touches the email-ingestion tables.
 *
 * The commit is one transaction on purpose. A booking that lands in
 * `trip_commitments` but whose outbox event never gets written would leave the
 * Pulse board silently stale — showing a trip that no longer matches its own
 * bookings, with nothing to indicate it. Either everything lands or nothing does.
 *
 * Duplicate protection has two independent layers, because webhooks retry and
 * humans double-click:
 *
 *   email_imports.message_id      UNIQUE — a re-delivered webhook is a no-op
 *   trip_commitments(trip_id, reference) UNIQUE — a second approval of the same
 *                                 booking updates rather than inserts
 */

/**
 * The stable key for a booking.
 *
 * Derived from the booking reference, never chosen by the caller. A caller
 * picking its own key means the same reservation imported twice lands under two
 * keys and becomes two commitments — which then both appear on the board and
 * BOTH count toward expected loss. Observed: one 612.45 hotel presented as
 * 1359.19 at risk.
 *
 * Reconciliation already matches on reference; the key must agree with it or
 * the two disagree about what "the same booking" means.
 */
export function commitmentKey(kind: string, reference: string | null | undefined): string {
  const clean = (reference ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const prefix = kind === "lodging" ? "stay" : kind;
  // With no reference there is nothing stable to key on, so the caller's key
  // stands — but such a booking cannot be deduplicated and should be reviewed.
  return clean ? `${prefix}_${clean}` : "";
}

export type ImportRow = {
  id: string;
  message_id: string;
  trip_id: string | null;
  from_address: string;
  subject: string;
  received_at: string;
  raw_ref: string;
  attachment_count: number;
  status: string;
  failure_reason: string;
};

export type ExtractionRow = {
  id: string;
  import_id: string;
  tier: string;
  classification: string;
  matched_commitment_key: string | null;
  payload: Record<string, unknown>;
  confidence: string;
  requires_review: boolean;
  review_reasons: string[];
};

/**
 * Record an arriving email. Returns the existing row when the message has been
 * seen before, so the caller can stop rather than re-extract.
 */
export async function recordImport(input: {
  messageId: string;
  tripId?: string | null;
  from?: string;
  subject?: string;
  rawRef?: string;
  attachmentCount?: number;
}): Promise<{ row: ImportRow; alreadySeen: boolean }> {
  const existing = await queryAurora<ImportRow>(
    `select * from email_imports where message_id = $1`,
    [input.messageId]
  );
  if (existing.length) return { row: existing[0], alreadySeen: true };

  const rows = await queryAurora<ImportRow>(
    `insert into email_imports
       (message_id, trip_id, from_address, subject, raw_ref, attachment_count)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (message_id) do update set message_id = excluded.message_id
     returning *`,
    [
      input.messageId,
      input.tripId ?? null,
      input.from ?? "",
      input.subject ?? "",
      input.rawRef ?? "",
      input.attachmentCount ?? 0
    ]
  );
  return { row: rows[0], alreadySeen: false };
}

export async function recordExtraction(input: {
  importId: string;
  tier: string;
  classification: string;
  matchedKey?: string | null;
  payload: unknown;
  confidence: number;
  requiresReview: boolean;
  reviewReasons: string[];
  evidence?: Array<{ field: string; text: string; page?: number | null; ref?: string }>;
}): Promise<ExtractionRow> {
  const rows = await queryAurora<ExtractionRow>(
    `insert into email_extractions
       (import_id, tier, classification, matched_commitment_key, payload,
        confidence, requires_review, review_reasons)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     returning *`,
    [
      input.importId,
      input.tier,
      input.classification,
      input.matchedKey ?? null,
      JSON.stringify(input.payload),
      input.confidence,
      input.requiresReview,
      input.reviewReasons
    ]
  );

  for (const e of input.evidence ?? []) {
    await queryAurora(
      `insert into extraction_evidence (extraction_id, field, source_text, page, evidence_ref)
       values ($1,$2,$3,$4,$5)`,
      [rows[0].id, e.field, e.text, e.page ?? null, e.ref ?? ""]
    );
  }

  await queryAurora(
    `update email_imports set status = $2 where id = $1`,
    [input.importId, input.requiresReview ? "needs_review" : "extracted"]
  );
  return rows[0];
}

/**
 * A human's correction, stored ALONGSIDE the extraction rather than over it.
 *
 * Overwriting the extraction would erase what the parser actually produced,
 * and with it any way to tell whether the parser or the document was wrong.
 */
export async function recordCorrection(input: {
  extractionId: string;
  field: string;
  originalValue: string | null;
  correctedValue: string | null;
  by?: string;
}): Promise<void> {
  await queryAurora(
    `insert into extraction_corrections
       (extraction_id, field, original_value, corrected_value, corrected_by)
     values ($1,$2,$3,$4,$5)
     on conflict (extraction_id, field) do update set
       corrected_value = excluded.corrected_value,
       corrected_by = excluded.corrected_by,
       corrected_at = now()`,
    [input.extractionId, input.field, input.originalValue, input.correctedValue, input.by ?? "traveller"]
  );
}

/** Extraction + corrections + evidence — everything a review screen needs. */
export async function loadForReview(importId: string) {
  const [extractions, corrections, evidence] = await Promise.all([
    queryAurora<ExtractionRow>(
      `select * from email_extractions where import_id = $1 order by confidence desc`,
      [importId]
    ),
    queryAurora<{ extraction_id: string; field: string; original_value: string; corrected_value: string }>(
      `select c.* from extraction_corrections c
         join email_extractions e on e.id = c.extraction_id
        where e.import_id = $1`,
      [importId]
    ),
    queryAurora<{ extraction_id: string; field: string; source_text: string; page: number }>(
      `select v.* from extraction_evidence v
         join email_extractions e on e.id = v.extraction_id
        where e.import_id = $1`,
      [importId]
    )
  ]);
  return { extractions, corrections, evidence };
}

export type CommitInput = {
  tripId: string;
  importId: string;
  extractionId: string;
  commitment: {
    key: string;
    label: string;
    kind: string;
    starts?: string | null;
    value?: number | null;
    currency?: string;
    refundable?: boolean;
    hardDeadline?: string | null;
    consequence?: string;
    reference?: string | null;
    source?: string;
    confidence?: number;
  };
  dependencies?: Array<{
    upstream: string;
    downstream: string;
    slackMinutes: number;
    transferMinutes?: number;
    note?: string;
  }>;
  eventType?: "commitment_committed" | "commitment_updated" | "commitment_cancelled";
};

/**
 * Commit an approved extraction. One transaction, or nothing.
 *
 * The outbox row is written HERE, inside the transaction, rather than by
 * calling the Pulse rebuild directly. An HTTP call cannot be rolled back, so a
 * failure mid-rebuild would leave a committed booking with no notification —
 * or worse, roll back a booking the traveller has already approved.
 */
export async function commitExtraction(input: CommitInput): Promise<{
  commitmentKey: string;
  created: boolean;
  outboxId: string;
}> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not configured");

  const client = await pool.connect();
  try {
    await client.query("begin");

    const c = input.commitment;

    // Unknown refundability is FALSE, never true. Assuming a booking is
    // refundable understates the loss on exactly the bookings that hurt most.
    const result = await client.query(
      `insert into trip_commitments
         (trip_id, key, label, kind, starts_at, value, currency, refundable,
          hard_deadline, consequence, source, confidence, needs_review,
          import_id, reference)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,$13,$14)
       on conflict (trip_id, key) do update set
         label = excluded.label, starts_at = excluded.starts_at,
         value = excluded.value, currency = excluded.currency,
         refundable = excluded.refundable, hard_deadline = excluded.hard_deadline,
         consequence = excluded.consequence, source = excluded.source,
         confidence = excluded.confidence, import_id = excluded.import_id,
         reference = excluded.reference
       returning key, (xmax = 0) as created`,
      [
        input.tripId,
        c.key,
        c.label,
        c.kind,
        c.starts ?? null,
        c.value ?? null,
        c.currency ?? "GBP",
        c.refundable === true,
        c.hardDeadline ?? null,
        c.consequence ?? "",
        c.source ?? "third_party",
        c.confidence ?? 0.8,
        input.importId,
        c.reference ?? null
      ]
    );

    for (const d of input.dependencies ?? []) {
      await client.query(
        `insert into trip_dependencies
           (trip_id, upstream_key, downstream_key, slack_minutes, transfer_minutes, note)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (trip_id, upstream_key, downstream_key) do update set
           slack_minutes = excluded.slack_minutes,
           transfer_minutes = excluded.transfer_minutes,
           note = excluded.note`,
        [input.tripId, d.upstream, d.downstream, d.slackMinutes, d.transferMinutes ?? 0, d.note ?? ""]
      );
    }

    // Derive the event from what the insert ACTUALLY did rather than from what
    // the caller expected. A re-approval that updates an existing row is an
    // update, and a downstream consumer that treats it as a new booking would
    // notify the traveller twice about one reservation.
    const created = result.rows[0].created as boolean;
    const outbox = await client.query(
      `insert into ingestion_outbox (trip_id, event_type, payload)
       values ($1,$2,$3) returning id`,
      [
        input.tripId,
        input.eventType ?? (created ? "commitment_committed" : "commitment_updated"),
        JSON.stringify({
          commitment_key: c.key,
          import_id: input.importId,
          extraction_id: input.extractionId
        })
      ]
    );

    await client.query(`update email_imports set status = 'committed' where id = $1`, [
      input.importId
    ]);

    await client.query("commit");
    return {
      commitmentKey: result.rows[0].key,
      created: result.rows[0].created,
      outboxId: outbox.rows[0].id
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Unprocessed side effects, oldest first. */
export async function pendingOutbox(limit = 20) {
  return queryAurora<{ id: string; trip_id: string; event_type: string; payload: Record<string, unknown> }>(
    `select id, trip_id, event_type, payload from ingestion_outbox
      where processed_at is null order by created_at limit $1`,
    [limit]
  );
}

export async function markOutboxProcessed(id: string, error?: string): Promise<void> {
  if (error) {
    await queryAurora(
      `update ingestion_outbox set attempts = attempts + 1, last_error = $2 where id = $1`,
      [id, error.slice(0, 500)]
    );
    return;
  }
  await queryAurora(`update ingestion_outbox set processed_at = now() where id = $1`, [id]);
}
