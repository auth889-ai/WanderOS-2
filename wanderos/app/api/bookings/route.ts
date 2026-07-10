import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/session";
import { createBooking, listTravelerBookings } from "@/lib/services/booking.service";

export const runtime = "nodejs";

/** POST /api/bookings — traveler reserves a stay (instant confirm, total stored in Aurora). */
export async function POST(req: NextRequest) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  const body = (await req.json().catch(() => ({}))) as { listingId?: string; checkIn?: string; checkOut?: string; guests?: number };
  if (!body.listingId) return NextResponse.json({ error: "listingId required" }, { status: 400 });
  const r = await createBooking(auth.session!.id, {
    listingId: body.listingId, checkIn: body.checkIn ?? "", checkOut: body.checkOut ?? "", guests: Number(body.guests) || 1
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ booking: r.booking }, { status: 201 });
}

/** GET /api/bookings — the traveler's own trips. */
export async function GET() {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  return NextResponse.json({ bookings: await listTravelerBookings(auth.session!.id) });
}
