import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { removeTripItem, updateTripItem } from "@/lib/services/trip.service";

export const runtime = "nodejs";

const PatchItemSchema = z.object({
  dayNumber: z.coerce.number().int().min(1).max(31).optional(),
  timeLabel: z.string().trim().max(30).nullable().optional(),
  title: z.string().trim().min(1).max(140).optional(),
  description: z.string().trim().max(700).nullable().optional(),
  category: z.string().trim().max(80).nullable().optional(),
  estCost: z.coerce.number().min(0).max(5000).optional(),
  locked: z.boolean().optional()
});

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string; itemId: string }> }) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;

  const parsed = PatchItemSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { id, itemId } = await context.params;
  try {
    const result = await updateTripItem(auth.session!.id, id, itemId, parsed.data);
    if (!result) return NextResponse.json({ error: "Item not found or not accessible." }, { status: 404 });
    return NextResponse.json({ item: result.item });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update item." }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string; itemId: string }> }) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;

  const { id, itemId } = await context.params;
  const result = await removeTripItem(auth.session!.id, id, itemId);
  if (!result) return NextResponse.json({ error: "Item not found or not accessible." }, { status: 404 });
  return NextResponse.json({ item: result.item });
}
