import { runGraph, StepInfo } from "@/lib/agents/runtime/graphRunner";
import { buildTripPlannerGraph } from "./graph";
import { TripPlannerInput, TripPlannerStateType } from "./state";
import { BudgetPlan, StayRecommendation, TripBriefSchema, TripPlanVerifierReport, VerifiedTripPlan } from "./schemas";

export type { TripPlannerInput } from "./state";

export type TripPlannerCrewResult = {
  runId: string;
  plan: VerifiedTripPlan;
  verifierReport: TripPlanVerifierReport;
  stayRecommendations: StayRecommendation[];
  budgetPlan: BudgetPlan;
};

/**
 * Run the WanderOS AI Trip Planner crew.
 * The crew uses LLMs/RAG for judgment, then deterministic composer/verifier gates all persisted output.
 */
export async function runTripPlanner(
  input: TripPlannerInput,
  onStep?: (info: StepInfo) => Promise<void> | void
): Promise<TripPlannerCrewResult> {
  const normalized: TripPlannerInput = {
    ...input,
    brief: TripBriefSchema.parse(input.brief),
    lockedItems: input.lockedItems ?? []
  };

  const { runId, output } = await runGraph<TripPlannerInput, TripPlannerStateType, Omit<TripPlannerCrewResult, "runId">>({
    workflow: "trip-planner",
    userId: normalized.travelerId,
    input: normalized,
    build: (node) => buildTripPlannerGraph(node),
    onStep,
    finalize: (final) => ({
      plan: final.verifiedPlan,
      verifierReport: final.verifierReport,
      stayRecommendations: final.stayRecommendations ?? [],
      budgetPlan: final.budgetPlan
    })
  });

  return { runId, ...output };
}
