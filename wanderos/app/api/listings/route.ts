import { NextRequest, NextResponse } from "next/server";
import { getSession, requireApiRole } from "@/lib/auth/session";
import { createListing, listByHost, listPublic } from "@/lib/db/tables/listings";

async function readBody(request: NextRequest) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return request.json().catch(() => ({}));
  }

  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

export async function GET() {
  const session = await getSession();

  if (session?.role === "host") {
    const listings = await listByHost(session.id);
    return NextResponse.json({ listings });
  }

  const listings = await listPublic();
  return NextResponse.json({ listings });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(["host"]);
  if (auth.response) return auth.response;

  const body = await readBody(request);
  const title = String(body.title || "").trim();
  const description = String(body.description || "").trim();
  const city = String(body.city || "").trim();
  const country = String(body.country || "").trim();

  if (!title || !description || !city || !country) {
    return NextResponse.json({ error: "Title, description, city, and country are required." }, { status: 400 });
  }

  // tags may arrive as an array (Studio JSON) or a comma string (plain form)
  const tags = Array.isArray(body.tags)
    ? body.tags.map(String)
    : String(body.tags || "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);

  const listing = await createListing({
    hostId: auth.session!.id,
    title,
    description,
    city,
    country,
    category: String(body.category || "experience"),
    price: Number(body.price || 0),
    tags,
    imageUrl: String(body.imageUrl || ""),
    // AI provenance from the Host Studio crew (optional):
    amenities: Array.isArray(body.amenities) ? body.amenities.map(String) : undefined,
    rooms: Array.isArray(body.rooms) ? body.rooms.map(String) : undefined,
    qualityScore: body.qualityScore != null ? Number(body.qualityScore) : undefined,
    pricingAnalysis: typeof body.pricingAnalysis === "object" && body.pricingAnalysis ? body.pricingAnalysis : undefined,
    status: body.status === "published" ? "published" : "draft"
  });

  return NextResponse.json({ listing }, { status: 201 });
}
