import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { refineTrip, TripPlannerQueueUnavailableError } from "@/lib/services/trip.service";

export const runtime = "nodejs";

const RefineSchema = z.object({
  instruction: z.string().trim().min(3).max(800)
});

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;

  const parsed = RefineSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { id } = await context.params;
  let result;
  try {
    result = await refineTrip(auth.session!.id, id, parsed.data.instruction);
  } catch (error) {
    if (error instanceof TripPlannerQueueUnavailableError) {
      return NextResponse.json(
        { error: "planner_queue_unavailable", message: error.message, tripId: error.tripId, status: "failed" },
        { status: 503 }
      );
    }
    throw error;
  }
  if (!result) return NextResponse.json({ error: "Trip not found or not accessible." }, { status: 404 });

  return NextResponse.json({ tripId: result.trip.id, jobId: result.jobId, status: result.trip.status }, { status: 202 });
}
