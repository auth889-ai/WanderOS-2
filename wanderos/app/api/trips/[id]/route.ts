import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/session";
import { getTrip } from "@/lib/services/trip.service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler", "admin"]);
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const result = await getTrip(auth.session!.id, id);

  if (!result) {
    return NextResponse.json({ error: "Trip not found or not accessible." }, { status: 404 });
  }

  return NextResponse.json(result);
}
