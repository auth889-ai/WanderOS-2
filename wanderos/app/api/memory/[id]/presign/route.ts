import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { requireApiRole } from "@/lib/auth/session";
import { getMemoryJobForOwner } from "@/lib/db/tables/memory-jobs";
import { B2NotConfiguredError, presignUpload, tripKey } from "@/lib/media/b2";

export const runtime = "nodejs";

const ALLOWED: Record<string, { folder: "originals"; maxMb: number }> = {
  "image/jpeg": { folder: "originals", maxMb: 15 },
  "image/png": { folder: "originals", maxMb: 15 },
  "image/webp": { folder: "originals", maxMb: 15 },
  "video/mp4": { folder: "originals", maxMb: 200 },
  "video/quicktime": { folder: "originals", maxMb: 200 },
  "application/pdf": { folder: "originals", maxMb: 20 }
};

const PresignSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  contentType: z.string().refine((ct) => ct in ALLOWED, "unsupported content type")
});

/** POST /api/memory/[id]/presign — browser uploads go DIRECT to B2; the app never proxies bytes. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["traveler", "admin"]);
  if (auth.response) return auth.response;

  const { id } = await params;
  const job = await getMemoryJobForOwner(id, auth.session!.id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = PresignSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const ext = parsed.data.filename.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const key = tripKey(job.id, "originals", `${randomUUID()}.${ext}`);

  try {
    const url = await presignUpload(key, parsed.data.contentType);
    return NextResponse.json({ key, url, expiresIn: 900 });
  } catch (error) {
    if (error instanceof B2NotConfiguredError) {
      return NextResponse.json({ error: "b2_not_configured", message: error.message }, { status: 503 });
    }
    throw error;
  }
}
