import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/session";
import { listForAdmin, setModeration, adminSetStatus } from "@/lib/db/tables/listings";

/** DELETE /api/admin/listings?id=… — admin soft-deletes a listing. */
export async function DELETE(request: NextRequest) {
  const auth = await requireApiRole(["admin"]);
  if (auth.response) return auth.response;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await adminSetStatus(id, "deleted");
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const auth = await requireApiRole(["admin"]);
  if (auth.response) return auth.response;

  const listings = await listForAdmin();
  return NextResponse.json({ listings });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireApiRole(["admin"]);
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => ({}));
  const listingId = String(body.listingId || "");
  const status = String(body.status || "");

  if (!listingId || !["approved", "rejected"].includes(status)) {
    return NextResponse.json({ error: "listingId and approved/rejected status are required." }, { status: 400 });
  }

  const listing = await setModeration(listingId, status as "approved" | "rejected");

  if (!listing) {
    return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  }

  return NextResponse.json({ listing });
}
