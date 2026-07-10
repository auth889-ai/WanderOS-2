import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { regenerateTrip, TripPlannerQueueUnavailableError } from "@/lib/services/trip.service";

export const runtime = "nodejs";

const RegenerateSchema = z.object({
  hint: z.string().trim().max(500).optional()
});

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;

  const parsed = RegenerateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { id } = await context.params;
  let result;
  try {
    result = await regenerateTrip(auth.session!.id, id, parsed.data.hint);
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
