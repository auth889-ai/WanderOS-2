import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { addTripItem } from "@/lib/services/trip.service";

export const runtime = "nodejs";

const AddItemSchema = z.object({
  dayNumber: z.coerce.number().int().min(1).max(31),
  timeLabel: z.string().trim().max(30).nullable().optional(),
  title: z.string().trim().min(1).max(140),
  description: z.string().trim().max(700).nullable().optional(),
  category: z.string().trim().max(80).nullable().optional(),
  estCost: z.coerce.number().min(0).max(5000).optional(),
  locked: z.boolean().optional()
});

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;

  const parsed = AddItemSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { id } = await context.params;
  try {
    const result = await addTripItem(auth.session!.id, id, parsed.data);
    if (!result) return NextResponse.json({ error: "Trip not found or not accessible." }, { status: 404 });
    return NextResponse.json({ item: result.item }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to add item." }, { status: 400 });
  }
}
