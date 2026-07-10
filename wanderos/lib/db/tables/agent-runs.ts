import { queryAurora } from "../pool";

/**
 * The only module that touches agent_runs / agent_steps.
 * This is the OBSERVABILITY backbone: every crew records a run and each agent records a step
 * here, so the admin "Agent Runs" observatory can show the live multi-agent trace — the proof
 * to judges that this is a real multi-agent system, not one Gemini call.
 */
export type RunStatus = "running" | "completed" | "failed";
export type StepStatus = "running" | "completed" | "failed";

export type AgentRunRow = {
  id: string;
  user_id: string | null;
  workflow: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  created_at: string;
  finished_at: string | null;
};

export type AgentStepRow = {
  id: string;
  run_id: string;
  agent_name: string;
  status: string;
  input_summary: string | null;
  output_summary: string | null;
  tool_used: string | null;
  sequence: number;
  created_at: string;
};

export async function createRun(params: {
  userId?: string | null;
  workflow: string;
  input: Record<string, unknown>;
}): Promise<AgentRunRow> {
  const rows = await queryAurora<AgentRunRow>(
    `insert into agent_runs (user_id, workflow, status, input)
     values ($1, $2, 'running', $3::jsonb)
     returning *`,
    [params.userId ?? null, params.workflow, JSON.stringify(params.input)]
  );
  return rows[0];
}

export async function finishRun(runId: string, output: Record<string, unknown>, status: RunStatus = "completed") {
  const rows = await queryAurora<AgentRunRow>(
    `update agent_runs set status = $2, output = $3::jsonb, finished_at = now()
     where id = $1 returning *`,
    [runId, status, JSON.stringify(output)]
  );
  return rows[0];
}

export async function addStep(params: {
  runId: string;
  agentName: string;
  status: StepStatus;
  sequence: number;
  inputSummary?: string;
  outputSummary?: string;
  toolUsed?: string;
}): Promise<AgentStepRow> {
  const rows = await queryAurora<AgentStepRow>(
    `insert into agent_steps (run_id, agent_name, status, input_summary, output_summary, tool_used, sequence)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning *`,
    [
      params.runId,
      params.agentName,
      params.status,
      params.inputSummary ?? null,
      params.outputSummary ?? null,
      params.toolUsed ?? null,
      params.sequence
    ]
  );
  return rows[0];
}

export async function getRunWithSteps(runId: string) {
  const runs = await queryAurora<AgentRunRow>(`select * from agent_runs where id = $1`, [runId]);
  if (!runs[0]) return null;
  const steps = await queryAurora<AgentStepRow>(
    `select * from agent_steps where run_id = $1 order by sequence asc`,
    [runId]
  );
  return { run: runs[0], steps };
}

/** Recent runs for the admin observatory. */
export async function listRecentRuns(limit = 20) {
  return queryAurora<AgentRunRow>(`select * from agent_runs order by created_at desc limit $1`, [limit]);
}
