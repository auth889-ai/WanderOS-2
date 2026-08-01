import { queryAurora } from "../pool";

/**
 * commitments.repo — the ONLY module that touches `trip_commitments`,
 * `trip_dependencies` and `trip_protections`.
 *
 * These three tables are what turn a list of bookings into a chain the cascade
 * can reason about. The columns that matter are the ones every other itinerary
 * app throws away: whether a booking is refundable, when it can no longer be
 * honoured at all, and what it is worth.
 */

export type CommitmentRow = {
  id: string;
  trip_id: string;
  key: string;
  label: string;
  kind: string;
  starts_at: string | null;
  value: string | null;
  currency: string;
  refundable: boolean;
  hard_deadline: string | null;
  consequence: string;
  source: string;
  confidence: string;
  needs_review: boolean;
  extracted_from: Record<string, unknown>;
};

export type DependencyRow = {
  upstream_key: string;
  downstream_key: string;
  slack_minutes: string;
  transfer_minutes: string;
  note: string;
};

export type ProtectionRow = {
  commitment_key: string;
  action: string;
  acted_by: string;
  reversible_until: string | null;
  created_at: string;
};

export async function listCommitments(tripId: string): Promise<CommitmentRow[]> {
  const rows = await queryAurora<CommitmentRow>(
    `select * from trip_commitments
      where trip_id = $1
      order by starts_at nulls last, created_at`,
    [tripId]
  );
  return rows;
}

export async function listDependencies(tripId: string): Promise<DependencyRow[]> {
  const rows = await queryAurora<DependencyRow>(
    `select upstream_key, downstream_key, slack_minutes, transfer_minutes, note
       from trip_dependencies where trip_id = $1`,
    [tripId]
  );
  return rows;
}

export async function listProtections(tripId: string): Promise<ProtectionRow[]> {
  const rows = await queryAurora<ProtectionRow>(
    `select commitment_key, action, acted_by, reversible_until, created_at
       from trip_protections where trip_id = $1 order by created_at`,
    [tripId]
  );
  return rows;
}

/**
 * Upsert on (trip_id, key) so re-photographing a confirmation corrects the
 * existing commitment rather than creating a duplicate the cascade would then
 * treat as a second booking.
 */
export async function saveCommitment(
  tripId: string,
  c: {
    key: string;
    label: string;
    kind?: string;
    starts?: string | null;
    value?: number | null;
    currency?: string;
    refundable?: boolean;
    hard_deadline?: string | null;
    consequence?: string;
    source?: string;
    confidence?: number;
    needs_review?: boolean;
    extracted_from?: unknown;
  }
): Promise<CommitmentRow> {
  const rows = await queryAurora<CommitmentRow>(
    `insert into trip_commitments
       (trip_id, key, label, kind, starts_at, value, currency, refundable,
        hard_deadline, consequence, source, confidence, needs_review, extracted_from)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     on conflict (trip_id, key) do update set
       label = excluded.label, kind = excluded.kind, starts_at = excluded.starts_at,
       value = excluded.value, currency = excluded.currency,
       refundable = excluded.refundable, hard_deadline = excluded.hard_deadline,
       consequence = excluded.consequence, source = excluded.source,
       confidence = excluded.confidence, needs_review = excluded.needs_review,
       extracted_from = excluded.extracted_from
     returning *`,
    [
      tripId,
      c.key,
      c.label,
      c.kind ?? "booking",
      c.starts ?? null,
      c.value ?? null,
      c.currency ?? "GBP",
      // Unknown refundability is false, never true. Assuming refundable
      // understates the loss on exactly the bookings that hurt most.
      c.refundable === true,
      c.hard_deadline ?? null,
      c.consequence ?? "",
      c.source ?? "third_party",
      c.confidence ?? 1.0,
      c.needs_review ?? false,
      JSON.stringify(c.extracted_from ?? {})
    ]
  );
  return rows[0];
}

export async function saveDependency(
  tripId: string,
  d: {
    upstream: string;
    downstream: string;
    slack_minutes: number;
    transfer_minutes?: number;
    note?: string;
  }
): Promise<void> {
  await queryAurora(
    `insert into trip_dependencies
       (trip_id, upstream_key, downstream_key, slack_minutes, transfer_minutes, note)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (trip_id, upstream_key, downstream_key) do update set
       slack_minutes = excluded.slack_minutes,
       transfer_minutes = excluded.transfer_minutes,
       note = excluded.note`,
    [tripId, d.upstream, d.downstream, d.slack_minutes, d.transfer_minutes ?? 0, d.note ?? ""]
  );
}

/**
 * Recording an action is the ONLY thing that turns a board node purple. It
 * requires naming what was actually done — a protection with no action would
 * be the product claiming credit for nothing.
 */
export async function recordProtection(
  tripId: string,
  p: { commitment_key: string; action: string; acted_by?: string; reversible_until?: string | null }
): Promise<void> {
  if (!p.action?.trim()) throw new Error("a protection must name what was done");
  await queryAurora(
    `insert into trip_protections (trip_id, commitment_key, action, acted_by, reversible_until)
     values ($1,$2,$3,$4,$5)`,
    [tripId, p.commitment_key, p.action, p.acted_by ?? "guardian", p.reversible_until ?? null]
  );
}

/** The shape the media worker's cascade + pulse endpoints consume. */
export async function toWorkerPayload(tripId: string) {
  const [commitments, dependencies, protections] = await Promise.all([
    listCommitments(tripId),
    listDependencies(tripId),
    listProtections(tripId)
  ]);

  return {
    commitments: commitments.map((c) => ({
      key: c.key,
      label: c.label,
      kind: c.kind,
      starts: c.starts_at,
      value: c.value === null ? null : Number(c.value),
      currency: c.currency,
      refundable: c.refundable,
      hard_deadline: c.hard_deadline,
      consequence: c.consequence
    })),
    dependencies: dependencies.map((d) => ({
      upstream: d.upstream_key,
      downstream: d.downstream_key,
      slack_minutes: Number(d.slack_minutes),
      transfer_minutes: Number(d.transfer_minutes),
      note: d.note
    })),
    protections
  };
}
