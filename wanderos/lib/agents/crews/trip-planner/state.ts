import { Annotation } from "@langchain/langgraph";
import type {
  BudgetPlan,
  DayArchitecture,
  DestinationIntelligence,
  ProfilerOutput,
  StayRecommendation,
  TripBrief,
  TripPlanItem,
  TripPlanVerifierReport,
  VerifiedTripPlan
} from "./schemas";
import type { ExternalEnrichmentSummary } from "./external-enrichment";
import type { LogisticsOptimizerResult } from "./agents/logistics-optimizer/schema";

/**
 * Shared LangGraph state for the trip planner crew.
 * Every LLM node writes a typed channel; deterministic composer/verifier channels gate persistence.
 */

export type TripPlannerInput = {
  tripId: string;
  travelerId: string;
  brief: TripBrief;
  lockedItems?: TripPlanItem[];
};

export const TripPlannerState = Annotation.Root({
  tripId: Annotation<string>(),
  travelerId: Annotation<string>(),
  brief: Annotation<TripBrief>(),
  lockedItems: Annotation<TripPlanItem[]>(),

  profile: Annotation<ProfilerOutput>(),
  destinationIntel: Annotation<DestinationIntelligence>(),
  stayRecommendations: Annotation<StayRecommendation[]>(),
  dayArchitecture: Annotation<DayArchitecture>(),
  activityCandidates: Annotation<TripPlanItem[]>(),
  logistics: Annotation<LogisticsOptimizerResult>(),
  enrichedItems: Annotation<TripPlanItem[]>(),
  explainedItems: Annotation<TripPlanItem[]>(),
  externalEnrichment: Annotation<ExternalEnrichmentSummary>(),
  budgetPlan: Annotation<BudgetPlan>(),

  verifiedPlan: Annotation<VerifiedTripPlan>(),
  verifierReport: Annotation<TripPlanVerifierReport>()
});

export type TripPlannerStateType = typeof TripPlannerState.State;
