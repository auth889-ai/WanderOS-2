import { createRun, finishRun, addStep } from "@/lib/db/tables/agent-runs";

/**
 * graphRunner — runs a LangGraph StateGraph with full observability.
 *
 * Creates an agent_run, gives the crew a `node()` wrapper that records each graph node to
 * agent_steps (tool + timing + summary), invokes the compiled graph, then finalizes the run.
 * This is how every crew stays visible in the admin observatory.
 */
function summarize(value: unknown, max = 240): string {
  if (value == null) return "";
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** Wrap a graph node so it logs to agent_steps. Use inside `build`. */
export type NodeWrap = <S>(name: string, tool: string, fn: (state: S) => Promise<Partial<S>>) => (state: S) => Promise<Partial<S>>;

export type CompiledGraph<I, F> = { invoke: (input: I) => Promise<F> };

/** Fired after each node completes — lets a caller (e.g. the worker job) report live progress + check cancel. */
export type StepInfo = { name: string; tool: string; sequence: number };

export async function runGraph<I extends Record<string, unknown>, F, O = F>(opts: {
  workflow: string;
  userId?: string | null;
  input: I;
  build: (node: NodeWrap) => CompiledGraph<I, F>;
  finalize?: (finalState: F) => O;
  /** called after each node finishes; throwing here aborts the crew (used for cooperative cancel) */
  onStep?: (info: StepInfo) => Promise<void> | void;
}): Promise<{ runId: string; output: O }> {
  const run = await createRun({ userId: opts.userId ?? null, workflow: opts.workflow, input: opts.input });
  let sequence = 0;

  // Logging the trace must NEVER crash the crew — a DB hiccup during observability is not a business
  // failure. Swallow trace-write errors (warn only); the agent's own errors still propagate.
  const safeAddStep = async (args: Parameters<typeof addStep>[0]) => {
    try {
      await addStep(args);
    } catch (e) {
      console.warn(`[trace] addStep failed (ignored): ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const node: NodeWrap = (name, tool, fn) => async (state) => {
    const seq = ++sequence;
    const start = Date.now();
    try {
      const out = await fn(state);
      await safeAddStep({
        runId: run.id,
        agentName: name,
        status: "completed",
        sequence: seq,
        toolUsed: tool,
        outputSummary: `${summarize(out)} (${Date.now() - start}ms)`
      });
      if (opts.onStep) await opts.onStep({ name, tool, sequence: seq }); // progress + cooperative cancel
      return out;
    } catch (err) {
      await safeAddStep({
        runId: run.id,
        agentName: name,
        status: "failed",
        sequence: seq,
        toolUsed: tool,
        outputSummary: `ERROR: ${err instanceof Error ? err.message : String(err)}`
      });
      throw err;
    }
  };

  try {
    const graph = opts.build(node);
    const finalState = await graph.invoke(opts.input);
    const output = (opts.finalize ? opts.finalize(finalState) : (finalState as unknown as O)) as O;
    await finishRun(run.id, output as Record<string, unknown>, "completed");
    return { runId: run.id, output };
  } catch (err) {
    await finishRun(run.id, { error: err instanceof Error ? err.message : String(err) }, "failed");
    throw err;
  }
}
