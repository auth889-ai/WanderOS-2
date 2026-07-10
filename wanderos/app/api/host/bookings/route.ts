import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/session";
import { listBookingsForHost } from "@/lib/db/tables/bookings";

export async function GET() {
  const auth = await requireApiRole(["host"]);
  if (auth.response) return auth.response;

  const bookings = await listBookingsForHost(auth.session!.id);
  return NextResponse.json({ bookings });
}
