import { NextRequest, NextResponse } from "next/server";

import { activeAction } from "@/lib/db/tables/journey-actions";
import { getOrder } from "@/lib/travel/duffel";

/**
 * GET /api/trips/:id/rescue/order — the held booking, read back from the airline.
 *
 * Fetched at read time rather than served from what was stored, so a schedule
 * change or a cancellation by the carrier shows up without anything being
 * re-saved. A booking the provider cannot confirm is reported as such.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const key = request.nextUrl.searchParams.get("commitment") ?? "flight";

  const action = await activeAction(id, key);
  if (!action?.provider_order_id) {
    return NextResponse.json({ error: "no held order for this commitment" }, { status: 404 });
  }

  const order = await getOrder(action.provider_order_id);
  if (!order.ok) {
    return NextResponse.json(
      { error: order.reason, reference: action.provider_reference },
      { status: 502 }
    );
  }
  return NextResponse.json({ ...order.data, mode: action.provider_mode });
}
