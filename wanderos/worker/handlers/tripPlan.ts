import { JobHandler } from "@/lib/queue/runner";
import { runTripPlanner } from "@/lib/agents/crews/trip-planner";
import { TripBrief, TripBriefSchema, TripPaceSchema } from "@/lib/agents/crews/trip-planner/schemas";
import { saveGeneratedPlan } from "@/lib/services/trip.service";
import { setTripStatus } from "@/lib/db/tables/trips";
import type { NewItineraryDay } from "@/lib/db/tables/trip/days";
import type { NewItineraryItem } from "@/lib/db/tables/trip/items";

/**
 * trip_plan handler - worker-owned AI itinerary path.
 * Premium crew is the only persisted path. Provider/model failures fail the job instead of saving fake plans.
 */
type TripPlanJobInput = {
  tripId?: string;
  travelerId?: string;
  destination?: string;
  startDate?: string;
  endDate?: string;
  budget?: number;
  travelStyle?: string;
  profile?: {
    party?: string;
    pace?: string;
    interests?: string[];
    constraints?: Record<string, unknown>;
    budget?: number;
    travelStyle?: string;
  };
};

const STAGE_PROGRESS: Record<string, { progress: number; message: string }> = {
  "trip-profiler": { progress: 12, message: "Profiling traveler intent" },
  "destination-intelligence": { progress: 24, message: "Researching destination context" },
  "stay-matcher": { progress: 36, message: "Matching real WanderOS stays" },
  "itinerary-designer": { progress: 60, message: "Designing premium itinerary flow" },
  "day-architect": { progress: 48, message: "Building day architecture" },
  "activity-curator": { progress: 60, message: "Curating itinerary activities" },
  "logistics-optimizer": { progress: 70, message: "Optimizing day flow" },
  "place-photo-enrichment": { progress: 74, message: "Enriching places, photos, and cost evidence" },
  "item-evidence-writer": { progress: 76, message: "Writing grounded item explanations" },
  "budget-optimizer": { progress: 78, message: "Optimizing budget" },
  "trip-composer": { progress: 84, message: "Composing editable plan" },
  "trip-verifier": { progress: 88, message: "Verifying itinerary rules" }
};

function numberOrUndefined(value?: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function safePace(value?: string) {
  const parsed = TripPaceSchema.safeParse(value);
  return parsed.success ? parsed.data : "balanced";
}

function buildBrief(input: TripPlanJobInput): TripBrief {
  const profile = input.profile ?? {};
  return TripBriefSchema.parse({
    destination: input.destination,
    startDate: input.startDate || undefined,
    endDate: input.endDate || undefined,
    budget: numberOrUndefined(input.budget ?? profile.budget),
    travelStyle: input.travelStyle || profile.travelStyle || undefined,
    interests: profile.interests ?? [],
    party: profile.party || "solo",
    pace: safePace(profile.pace),
    constraints: profile.constraints ?? {}
  });
}

export const tripPlanHandler: JobHandler = async (ctx) => {
  const input = ctx.input as TripPlanJobInput;
  if (!input.tripId || !input.travelerId || !input.destination) {
    throw new Error("trip_plan job requires tripId, travelerId, and destination.");
  }

  const brief = buildBrief(input);

  await ctx.reportProgress(6, "Preparing premium trip planner crew");
  await ctx.throwIfCancelled();

  let runId: string | null = null;
  let summary = "";
  let planningContext: Record<string, unknown> = {};
  let verifierReport: Record<string, unknown> = {};
  let totalEstimate = 0;
  let days: NewItineraryDay[] = [];
  let items: NewItineraryItem[] = [];

  const result = await runTripPlanner(
    {
      tripId: input.tripId,
      travelerId: input.travelerId,
      brief,
      lockedItems: []
    },
    async (step) => {
      const stage = STAGE_PROGRESS[step.name] ?? { progress: 50, message: `Completed ${step.name}` };
      await ctx.reportProgress(stage.progress, stage.message);
      await ctx.throwIfCancelled();
    }
  ).catch(async (error) => {
    await setTripStatus(input.tripId!, "failed");
    throw error;
  });

  runId = result.runId;
  summary = result.plan.summary;
  planningContext = {
    ...result.plan.planningContext,
    agentRunId: result.runId,
    crew: "trip-planner"
  };
  verifierReport = result.verifierReport as unknown as Record<string, unknown>;
  totalEstimate = result.plan.totalEstimate;
  days = result.plan.days;
  items = result.plan.items;

  await ctx.reportProgress(90, "Persisting editable itinerary");
  await ctx.throwIfCancelled();

  const saved = await saveGeneratedPlan({
    tripId: input.tripId,
    travelerId: input.travelerId,
    mode: "ai",
    inputSnapshot: input as Record<string, unknown>,
    planningContext,
    summary,
    verifierReport,
    totalEstimate,
    days,
    items
  });

  await ctx.reportProgress(96, "Persisted editable itinerary");
  await ctx.throwIfCancelled();

  return {
    tripId: input.tripId,
    travelerId: input.travelerId,
    runId,
    planVersionId: saved.version.id,
    dayCount: saved.days.length,
    itemCount: saved.items.length,
    status: "plan_ready",
    mode: "ai"
  };
};
