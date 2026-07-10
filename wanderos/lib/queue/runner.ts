import {
  getJob,
  markRunning,
  updateProgress,
  markSucceeded,
  markFailed,
  markCancelled
} from "@/lib/db/tables/agent-jobs";

/** Thrown by ctx.throwIfCancelled() when the host requested cancellation. */
export class JobCancelledError extends Error {
  constructor() {
    super("job cancelled");
    this.name = "JobCancelledError";
  }
}

/** What every crew handler receives. The handler does the work and reports progress; the runner owns state. */
export type JobContext = {
  agentJobId: string;
  input: Record<string, unknown>;
  /** live progress (0-100 + current stage) → streamed to the UI via the agent_jobs row */
  reportProgress: (percent: number, stage: string) => Promise<void>;
  /** call between stages: throws JobCancelledError if the host requested cancel */
  throwIfCancelled: () => Promise<void>;
  /** keep the BullMQ lock alive on long (minutes) jobs so they aren't falsely "stalled" */
  heartbeat: () => Promise<void>;
};

export type JobHandler = (ctx: JobContext) => Promise<Record<string, unknown>>;

/**
 * The single generic job runner — reused by the studio crew (P3) and the video crew (P10).
 * Drives the agent_jobs lifecycle around a handler:
 *   markRunning → handler(reports progress / checks cancel) → markSucceeded | markCancelled | markFailed.
 * On a non-final failure it rethrows so BullMQ retries; it only marks 'failed' on the LAST attempt.
 */
export async function runJob(opts: {
  agentJobId: string;
  isLastAttempt: boolean;
  handler: JobHandler;
  runId?: string | null;
  extendLock?: () => Promise<void>;
}): Promise<void> {
  const job = await getJob(opts.agentJobId);
  if (!job) throw new Error(`agent_job not found: ${opts.agentJobId}`);

  // honor a cancel requested before we even started
  if (job.status === "cancelled" || job.cancel_requested) {
    await markCancelled(opts.agentJobId);
    return;
  }

  await markRunning(opts.agentJobId, opts.runId ?? null);

  try {
    const ctx: JobContext = {
      agentJobId: opts.agentJobId,
      input: job.input,
      reportProgress: (percent, stage) => updateProgress(opts.agentJobId, percent, stage),
      throwIfCancelled: async () => {
        const fresh = await getJob(opts.agentJobId);
        if (fresh?.cancel_requested) throw new JobCancelledError();
      },
      heartbeat: async () => {
        if (opts.extendLock) await opts.extendLock();
      }
    };

    await ctx.throwIfCancelled();
    const output = await opts.handler(ctx);
    await markSucceeded(opts.agentJobId, output);
  } catch (err) {
    if (err instanceof JobCancelledError) {
      await markCancelled(opts.agentJobId);
      return; // not a failure — don't retry
    }
    if (opts.isLastAttempt) {
      await markFailed(opts.agentJobId, err instanceof Error ? err.message : String(err));
    }
    throw err; // rethrow so BullMQ retries (until attempts are exhausted)
  }
}
