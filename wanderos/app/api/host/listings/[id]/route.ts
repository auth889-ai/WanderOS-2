import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { getListing, editListing, deleteListing } from "@/lib/services/listing.service";

export const runtime = "nodejs";

const PatchSchema = z
  .object({
    title: z.string().min(3),
    description: z.string().min(10),
    price: z.number().positive(),
    bedrooms: z.number().int().min(0),
    bathrooms: z.number().min(0),
    maxGuests: z.number().int().min(1),
    amenities: z.array(z.string()),
    houseRules: z.string(),
    tags: z.array(z.string())
  })
  .partial(); // any subset of editable fields

/** GET /api/host/listings/[id] — one listing (owner only). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["host"]);
  if (auth.response) return auth.response;
  const { id } = await params;
  const listing = await getListing(id);
  if (!listing || listing.host_id !== auth.session!.id) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ listing });
}

/** PATCH /api/host/listings/[id] — edit any time (service enforces RBAC + versioning + editable state). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["host"]);
  if (auth.response) return auth.response;
  const { id } = await params;
  const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const updated = await editListing(id, auth.session!.id, parsed.data);
  if (!updated) return NextResponse.json({ error: "Not found, not owner, or not editable." }, { status: 403 });
  return NextResponse.json({ listing: updated });
}

/** DELETE /api/host/listings/[id] — soft delete (owner only). */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["host"]);
  if (auth.response) return auth.response;
  const { id } = await params;
  const r = await deleteListing(id, auth.session!.id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ listing: r.listing });
}
