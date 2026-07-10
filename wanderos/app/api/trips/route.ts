import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { listTripsForUser } from "@/lib/db/tables/trips";
import { startPlan, TripPlannerQueueUnavailableError } from "@/lib/services/trip.service";

export const runtime = "nodejs";

const StartPlanSchema = z.object({
  title: z.string().trim().optional(),
  destination: z.string().trim().min(1),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
  budget: z.coerce.number().min(0).optional(),
  travelStyle: z.string().trim().optional(),
  interests: z.array(z.string()).optional(),
  party: z.string().trim().optional(),
  pace: z.string().trim().optional(),
  constraints: z.record(z.unknown()).optional()
});

export async function GET() {
  const auth = await requireApiRole(["traveler", "admin"]);
  if (auth.response) return auth.response;

  const trips = await listTripsForUser(auth.session!.id);
  return NextResponse.json({ trips });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;

  const parsed = StartPlanSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const { trip, jobId } = await startPlan(auth.session!.id, parsed.data);
    return NextResponse.json({ trip, tripId: trip.id, jobId, status: trip.status }, { status: 202 });
  } catch (error) {
    if (error instanceof TripPlannerQueueUnavailableError) {
      return NextResponse.json(
        {
          error: "planner_queue_unavailable",
          message: error.message,
          tripId: error.tripId,
          status: "failed"
        },
        { status: 503 }
      );
    }
    throw error;
  }
}
