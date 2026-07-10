import { queryAurora } from "../../pool";

/**
 * trip-plan-versions.repo - owns only the trip_plan_versions table.
 */

export type PlanStatus = "draft" | "active" | "archived";
export type PlanGenerationMode = "ai" | "manual";

export type TripPlanVersionRow = {
  id: string;
  trip_id: string;
  version: number;
  status: PlanStatus;
  generation_mode: PlanGenerationMode;
  input_snapshot: Record<string, unknown>;
  planning_context: Record<string, unknown>;
  ai_summary: string | null;
  verifier_report: Record<string, unknown>;
  total_estimate: string;
  created_by: string | null;
  created_at: string;
};

export async function createPlanVersion(params: {
  tripId: string;
  mode?: PlanGenerationMode;
  inputSnapshot?: Record<string, unknown>;
  planningContext?: Record<string, unknown>;
  summary?: string | null;
  verifierReport?: Record<string, unknown>;
  totalEstimate?: number;
  createdBy?: string | null;
  status?: PlanStatus;
}): Promise<TripPlanVersionRow> {
  const status = params.status ?? "active";

  if (status === "active") {
    await queryAurora(
      `update trip_plan_versions
          set status = 'archived'
        where trip_id = $1 and status = 'active'`,
      [params.tripId]
    );
  }

  const rows = await queryAurora<TripPlanVersionRow>(
    `insert into trip_plan_versions (
       trip_id,
       version,
       status,
       generation_mode,
       input_snapshot,
       planning_context,
       ai_summary,
       verifier_report,
       total_estimate,
       created_by
     )
     values (
       $1,
       coalesce((select max(version) + 1 from trip_plan_versions where trip_id = $1), 1),
       $2,
       $3,
       $4::jsonb,
       $5::jsonb,
       $6,
       $7::jsonb,
       $8,
       $9
     )
     returning *`,
    [
      params.tripId,
      status,
      params.mode ?? "ai",
      JSON.stringify(params.inputSnapshot ?? {}),
      JSON.stringify(params.planningContext ?? {}),
      params.summary ?? null,
      JSON.stringify(params.verifierReport ?? {}),
      params.totalEstimate ?? 0,
      params.createdBy ?? null
    ]
  );

  return rows[0];
}

export async function getActivePlanVersion(tripId: string): Promise<TripPlanVersionRow | null> {
  const rows = await queryAurora<TripPlanVersionRow>(
    `select *
       from trip_plan_versions
      where trip_id = $1
      order by case when status = 'active' then 0 else 1 end, version desc
      limit 1`,
    [tripId]
  );
  return rows[0] ?? null;
}

export async function listPlanVersions(tripId: string): Promise<TripPlanVersionRow[]> {
  return queryAurora<TripPlanVersionRow>(
    `select *
       from trip_plan_versions
      where trip_id = $1
      order by version desc`,
    [tripId]
  );
}
