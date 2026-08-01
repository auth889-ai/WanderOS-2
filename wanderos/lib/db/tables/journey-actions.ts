import { getPool, queryAurora } from "../pool";

/**
 * journey-actions.repo — the persisted lifecycle of a rescue.
 *
 * A Pulse node turns purple ONLY when a row here is 'verified' AND carries a
 * provider reference. Anywhere else that rule is duplicated it can drift; here
 * it is one function, `isProtected`, and every caller asks it.
 */

export type ActionState =
  | "detected" | "simulated" | "priced" | "held" | "approved"
  | "executing" | "verified" | "rejected" | "expired" | "failed";

export type JourneyAction = {
  id: string;
  trip_id: string;
  commitment_key: string;
  thread_id: string;
  state: ActionState;
  options: unknown[];
  chosen_offer_id: string | null;
  provider: string;
  provider_mode: "sandbox" | "live";
  provider_order_id: string | null;
  provider_reference: string | null;
  amount: string | null;
  currency: string;
  rollback_deadline: string | null;
  approved_at: string | null;
  approved_by: string | null;
  verified_at: string | null;
  failure_reason: string;
  created_at: string;
  updated_at: string;
};

/**
 * The single definition of "protected".
 *
 * Both conditions matter: a verified state with no provider reference means we
 * believe something the provider never confirmed, and a reference without
 * verification means we asked but never checked the answer.
 */
export function isProtected(action: Pick<JourneyAction, "state" | "provider_reference"> | null): boolean {
  return Boolean(action && action.state === "verified" && action.provider_reference);
}

export async function activeAction(tripId: string, commitmentKey: string): Promise<JourneyAction | null> {
  const rows = await queryAurora<JourneyAction>(
    `select * from journey_actions
      where trip_id = $1 and commitment_key = $2
      order by created_at desc limit 1`,
    [tripId, commitmentKey]
  );
  return rows[0] ?? null;
}

export async function actionByThread(threadId: string): Promise<JourneyAction | null> {
  const rows = await queryAurora<JourneyAction>(
    `select * from journey_actions where thread_id = $1`, [threadId]
  );
  return rows[0] ?? null;
}

export async function listActions(tripId: string): Promise<JourneyAction[]> {
  return queryAurora<JourneyAction>(
    `select * from journey_actions where trip_id = $1 order by created_at desc`, [tripId]
  );
}

export async function actionEvents(actionId: string) {
  return queryAurora<{ from_state: string | null; to_state: string; detail: string; created_at: string }>(
    `select from_state, to_state, detail, created_at
       from journey_action_events where action_id = $1 order by created_at`,
    [actionId]
  );
}

/**
 * Start a rescue, or return the one already running.
 *
 * The partial unique index makes a second concurrent rescue for the same
 * commitment impossible at the database level — two would hold two seats and
 * the traveller would be charged for both.
 */
export async function startAction(input: {
  tripId: string;
  commitmentKey: string;
  threadId: string;
  providerMode?: "sandbox" | "live";
}): Promise<{ action: JourneyAction; resumed: boolean }> {
  const existing = await activeAction(input.tripId, input.commitmentKey);
  if (existing && !["rejected", "expired", "failed", "verified"].includes(existing.state)) {
    return { action: existing, resumed: true };
  }

  const rows = await queryAurora<JourneyAction>(
    `insert into journey_actions (trip_id, commitment_key, thread_id, provider_mode)
     values ($1,$2,$3,$4) returning *`,
    [input.tripId, input.commitmentKey, input.threadId, input.providerMode ?? "sandbox"]
  );
  await recordEvent(rows[0].id, null, "detected", "Rescue started");
  return { action: rows[0], resumed: false };
}

export async function recordEvent(
  actionId: string, from: string | null, to: string, detail: string, payload: unknown = {}
): Promise<void> {
  await queryAurora(
    `insert into journey_action_events (action_id, from_state, to_state, detail, payload)
     values ($1,$2,$3,$4,$5)`,
    [actionId, from, to, detail, JSON.stringify(payload)]
  );
}

/**
 * Move an action forward. Returns the updated row.
 *
 * The transition and its event are written in ONE transaction: a state change
 * with no event would be an action nobody can audit, which for an automated
 * money-moving step is the same as no action at all.
 */
export async function transition(input: {
  actionId: string;
  to: ActionState;
  detail: string;
  patch?: Partial<{
    options: unknown[];
    chosen_offer_id: string | null;
    provider_order_id: string | null;
    provider_reference: string | null;
    amount: number | null;
    currency: string;
    rollback_deadline: string | null;
    approved_by: string | null;
    failure_reason: string;
  }>;
}): Promise<JourneyAction> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not configured");
  const client = await pool.connect();
  try {
    await client.query("begin");
    const before = await client.query<JourneyAction>(
      `select state from journey_actions where id = $1 for update`, [input.actionId]
    );
    const from: string | null = before.rows[0]?.state ?? null;

    const p = input.patch ?? {};
    const rows = await client.query<JourneyAction>(
      `update journey_actions set
         state = $2,
         options = coalesce($3, options),
         chosen_offer_id = coalesce($4, chosen_offer_id),
         provider_order_id = coalesce($5, provider_order_id),
         provider_reference = coalesce($6, provider_reference),
         amount = coalesce($7, amount),
         currency = coalesce($8, currency),
         rollback_deadline = coalesce($9, rollback_deadline),
         approved_by = coalesce($10, approved_by),
         approved_at = case when $2 = 'approved' then now() else approved_at end,
         verified_at = case when $2 = 'verified' then now() else verified_at end,
         failure_reason = coalesce($11, failure_reason),
         updated_at = now()
       where id = $1 returning *`,
      [
        input.actionId, input.to,
        p.options ? JSON.stringify(p.options) : null,
        p.chosen_offer_id ?? null, p.provider_order_id ?? null,
        p.provider_reference ?? null, p.amount ?? null, p.currency ?? null,
        p.rollback_deadline ?? null, p.approved_by ?? null, p.failure_reason ?? null
      ]
    );
    await client.query(
      `insert into journey_action_events (action_id, from_state, to_state, detail)
       values ($1,$2,$3,$4)`,
      [input.actionId, from, input.to, input.detail]
    );
    await client.query("commit");
    return rows.rows[0];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** A hold past its deadline is not a hold. */
export async function expireStale(): Promise<number> {
  const rows = await queryAurora<{ id: string }>(
    `update journey_actions set state='expired', updated_at=now()
      where rollback_deadline is not null
        and rollback_deadline < now()
        and state in ('held','priced','approved')
      returning id`
  );
  for (const r of rows) {
    await recordEvent(r.id, null, "expired", "Hold lapsed before it was paid for");
  }
  return rows.length;
}
