import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth/session";
import { createDraftPost } from "@/lib/services/post.service";

export const runtime = "nodejs";

const MediaSchema = z.object({
  mediaUrl: z.string().trim().url(),
  mediaKind: z.enum(["photo", "video", "reel"]).optional(),
  sortOrder: z.coerce.number().int().min(0).max(50).optional(),
  cloudinaryPublicId: z.string().trim().nullable().optional(),
  width: z.coerce.number().int().positive().nullable().optional(),
  height: z.coerce.number().int().positive().nullable().optional(),
  durationSeconds: z.coerce.number().nonnegative().nullable().optional(),
  aiDescription: z.string().trim().max(500).nullable().optional()
});

const CreatePostSchema = z.object({
  tripId: z.string().uuid().nullable().optional(),
  listingId: z.string().uuid().nullable().optional(),
  bookingId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(160),
  caption: z.string().trim().max(2000).nullable().optional(),
  body: z.string().trim().max(10000).nullable().optional(),
  location: z.string().trim().max(160).nullable().optional(),
  destination: z.string().trim().max(120).nullable().optional(),
  mood: z.string().trim().max(80).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  visibility: z.enum(["public", "private"]).optional(),
  postType: z.enum(["text", "photo", "carousel", "reel", "trip_recap"]).optional(),
  media: z.array(MediaSchema).max(12).optional()
});

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;

  const parsed = CreatePostSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const result = await createDraftPost(auth.session!.id, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create post draft." },
      { status: 400 }
    );
  }
}
