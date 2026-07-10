import { randomUUID } from "crypto";
import {
  createTripDraft,
  getTripForUser,
  setTripStatus,
  TripRow,
  updateTripProfile
} from "@/lib/db/tables/trips";
import {
  createPlanVersion,
  getActivePlanVersion,
  PlanGenerationMode,
  TripPlanVersionRow
} from "@/lib/db/tables/trip/plan-versions";
import {
  listItineraryDays,
  ItineraryDayRow,
  NewItineraryDay,
  saveItineraryDays
} from "@/lib/db/tables/trip/days";
import {
  createItineraryItem,
  deleteItineraryItem,
  editItineraryItem,
  getItineraryItemForTrip,
  listItineraryItems,
  ItineraryItemPatch,
  ItineraryItemRow,
  NewItineraryItem,
  saveItineraryItems
} from "@/lib/db/tables/trip/items";
import { AgentJobRow, listJobsForTrip } from "@/lib/db/tables/agent-jobs";
import { enqueueJob } from "@/lib/queue/queues";

/**
 * trip.service - business layer for traveler trips.
 * Routes and workers should call this service instead of composing trip SQL directly.
 */

export type ActiveTripPlan = {
  version: TripPlanVersionRow;
  days: ItineraryDayRow[];
  items: ItineraryItemRow[];
};

export type TripWithPlan = {
  trip: TripRow;
  activePlan: ActiveTripPlan | null;
};

export type StartPlanInput = {
  destination: string;
  startDate?: string;
  endDate?: string;
  budget?: number;
  travelStyle?: string;
  interests?: string[];
  party?: string;
  pace?: string;
  constraints?: Record<string, unknown>;
  title?: string;
};

export type StartPlanResult = {
  trip: TripRow;
  jobId: string;
};

export type ReplanTripResult = {
  trip: TripRow;
  jobId: string;
};

export type GeneratedTripPlanInput = {
  tripId: string;
  travelerId: string;
  mode: PlanGenerationMode;
  inputSnapshot?: Record<string, unknown>;
  planningContext?: Record<string, unknown>;
  summary?: string | null;
  verifierReport?: Record<string, unknown>;
  totalEstimate?: number;
  days: NewItineraryDay[];
  items: NewItineraryItem[];
};

export type GeneratedTripPlanResult = {
  version: TripPlanVersionRow;
  days: ItineraryDayRow[];
  items: ItineraryItemRow[];
};

export type TripItemMutationResult = {
  trip: TripRow;
  item: ItineraryItemRow;
};

export class TripPlannerQueueUnavailableError extends Error {
  tripId?: string;

  constructor(message: string, tripId?: string) {
    super(message);
    this.name = "TripPlannerQueueUnavailableError";
    this.tripId = tripId;
  }
}

function queueErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/max requests limit exceeded/i.test(message)) {
    return "Planner queue is unavailable because the Redis provider quota is exhausted.";
  }
  return "Planner queue is unavailable. Try again after the queue provider recovers.";
}

export async function startPlan(travelerId: string, input: StartPlanInput): Promise<StartPlanResult> {
  const destination = input.destination.trim();
  const title = input.title?.trim() || `${destination} Trip`;
  const travelStyle = input.travelStyle?.trim() || "";

  const draft = await createTripDraft({
    travelerId,
    title,
    destination,
    startDate: input.startDate,
    endDate: input.endDate,
    budget: input.budget,
    travelStyle
  });

  const profile = {
    party: input.party?.trim() || "solo",
    pace: input.pace?.trim() || "balanced",
    interests: input.interests ?? [],
    constraints: input.constraints ?? {},
    budget: input.budget ?? 0,
    travelStyle
  };

  await updateTripProfile(draft.id, profile);
  const trip = (await setTripStatus(draft.id, "planning")) ?? draft;
  try {
    const job = await enqueueJob({
      type: "trip_plan",
      userId: travelerId,
      idempotencyKey: `trip-plan-${draft.id}`,
      input: {
        tripId: draft.id,
        travelerId,
        destination,
        startDate: input.startDate ?? "",
        endDate: input.endDate ?? "",
        budget: input.budget ?? 0,
        travelStyle,
        profile
      }
    });

    return { trip, jobId: job.id };
  } catch (error) {
    await setTripStatus(draft.id, "failed").catch(() => {});
    throw new TripPlannerQueueUnavailableError(queueErrorMessage(error), draft.id);
  }
}

export async function getTrip(travelerId: string, tripId: string): Promise<TripWithPlan | null> {
  const trip = await getTripForUser(tripId, travelerId);
  if (!trip) return null;

  const version = await getActivePlanVersion(tripId);
  if (!version) {
    return { trip, activePlan: null };
  }

  const [days, items] = await Promise.all([
    listItineraryDays(version.id),
    listItineraryItems(version.id)
  ]);

  return {
    trip,
    activePlan: {
      version,
      days,
      items
    }
  };
}

function tripProfile(trip: TripRow): Record<string, unknown> {
  return {
    ...(trip.profile ?? {}),
    budget: Number(trip.budget ?? 0),
    travelStyle: trip.travel_style ?? ""
  };
}

async function enqueueTripReplan(params: {
  travelerId: string;
  trip: TripRow;
  mode: "regenerate" | "refine";
  hint?: string;
  instruction?: string;
}): Promise<ReplanTripResult> {
  const profile = tripProfile(params.trip);
  const constraints = {
    ...((profile.constraints as Record<string, unknown> | undefined) ?? {}),
    ...(params.hint ? { regenerateHint: params.hint } : {}),
    ...(params.instruction ? { refineInstruction: params.instruction } : {})
  };

  await setTripStatus(params.trip.id, "planning");

  let job;
  try {
    job = await enqueueJob({
      type: "trip_plan",
      userId: params.travelerId,
      idempotencyKey: `trip-${params.mode}-${params.trip.id}-${randomUUID()}`,
      input: {
        tripId: params.trip.id,
        travelerId: params.travelerId,
        destination: params.trip.destination,
        startDate: params.trip.start_date ?? "",
        endDate: params.trip.end_date ?? "",
        budget: Number(params.trip.budget ?? 0),
        travelStyle: params.trip.travel_style ?? "",
        profile: {
          ...profile,
          constraints
        },
        requestMode: params.mode,
        hint: params.hint ?? "",
        instruction: params.instruction ?? ""
      }
    });
  } catch (error) {
    await setTripStatus(params.trip.id, "failed").catch(() => {});
    throw new TripPlannerQueueUnavailableError(queueErrorMessage(error), params.trip.id);
  }

  return { trip: (await setTripStatus(params.trip.id, "planning")) ?? params.trip, jobId: job.id };
}

export async function regenerateTrip(travelerId: string, tripId: string, hint?: string): Promise<ReplanTripResult | null> {
  const trip = await getTripForUser(tripId, travelerId);
  if (!trip) return null;
  return enqueueTripReplan({ travelerId, trip, mode: "regenerate", hint: hint?.trim() || undefined });
}

export async function refineTrip(travelerId: string, tripId: string, instruction: string): Promise<ReplanTripResult | null> {
  const trip = await getTripForUser(tripId, travelerId);
  if (!trip) return null;
  return enqueueTripReplan({ travelerId, trip, mode: "refine", instruction: instruction.trim() });
}

export async function listTripJobs(travelerId: string, tripId: string): Promise<AgentJobRow[] | null> {
  const trip = await getTripForUser(tripId, travelerId);
  if (!trip) return null;
  return listJobsForTrip(tripId);
}

export async function saveGeneratedPlan(input: GeneratedTripPlanInput): Promise<GeneratedTripPlanResult> {
  const trip = await getTripForUser(input.tripId, input.travelerId);
  if (!trip) throw new Error("Trip not found or not accessible.");

  const version = await createPlanVersion({
    tripId: input.tripId,
    mode: input.mode,
    inputSnapshot: input.inputSnapshot,
    planningContext: input.planningContext,
    summary: input.summary,
    verifierReport: input.verifierReport,
    totalEstimate: input.totalEstimate,
    createdBy: input.travelerId,
    status: "active"
  });

  const [days, items] = await Promise.all([
    saveItineraryDays({ tripId: input.tripId, planVersionId: version.id, days: input.days }),
    saveItineraryItems({ tripId: input.tripId, planVersionId: version.id, items: input.items })
  ]);

  await setTripStatus(input.tripId, "ready");

  return { version, days, items };
}

function assertDayExists(days: ItineraryDayRow[], dayNumber: number) {
  if (!days.some((day) => day.day_number === dayNumber)) {
    throw new Error(`Day ${dayNumber} does not exist on the active plan.`);
  }
}

export async function addTripItem(
  travelerId: string,
  tripId: string,
  item: NewItineraryItem
): Promise<TripItemMutationResult | null> {
  const trip = await getTripForUser(tripId, travelerId);
  if (!trip) return null;

  const version = await getActivePlanVersion(tripId);
  if (!version) throw new Error("Trip does not have an active plan version yet.");

  const days = await listItineraryDays(version.id);
  assertDayExists(days, item.dayNumber);

  const saved = await createItineraryItem({
    tripId,
    planVersionId: version.id,
    item: {
      ...item,
      source: item.source ?? "traveler"
    }
  });
  return { trip, item: saved };
}

export async function updateTripItem(
  travelerId: string,
  tripId: string,
  itemId: string,
  patch: ItineraryItemPatch
): Promise<TripItemMutationResult | null> {
  const trip = await getTripForUser(tripId, travelerId);
  if (!trip) return null;

  const current = await getItineraryItemForTrip(tripId, itemId);
  if (!current) return null;

  if (typeof patch.dayNumber === "number") {
    const version = await getActivePlanVersion(tripId);
    if (!version) throw new Error("Trip does not have an active plan version yet.");
    const days = await listItineraryDays(version.id);
    assertDayExists(days, patch.dayNumber);
  }

  const updated = await editItineraryItem(itemId, patch);
  if (!updated) return null;
  return { trip, item: updated };
}

export async function removeTripItem(
  travelerId: string,
  tripId: string,
  itemId: string
): Promise<TripItemMutationResult | null> {
  const trip = await getTripForUser(tripId, travelerId);
  if (!trip) return null;

  const current = await getItineraryItemForTrip(tripId, itemId);
  if (!current) return null;

  const deleted = await deleteItineraryItem(itemId);
  if (!deleted) return null;
  return { trip, item: deleted };
}
