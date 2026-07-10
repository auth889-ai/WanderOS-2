import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/session";

export const runtime = "nodejs";

/** Agent action endpoint for cinematic renders (film/variants/portals). Reports which generative engines are wired (fal Veo/Kling/FLUX). */
export async function POST(request: NextRequest) {
  const auth = await requireApiRole(["traveler"]);
  if (auth.response) return auth.response;
  const { kind } = await request.json().catch(() => ({ kind: "" }));

  const hasFal = !!process.env.FAL_KEY;
  const hasVeo = !!(process.env.GOOGLE_PROJECT_ID && process.env.GOOGLE_LOCATION);
  const video = hasVeo ? "Veo 3.1" : hasFal ? "fal Kling v2.1" : null;

  if (!video) {
    return NextResponse.json({ ready: false, message: "🔑 Cinematic render needs a media key — add FAL_KEY (fal.ai) for video/image, or Veo (GOOGLE_PROJECT_ID + GOOGLE_LOCATION)." });
  }
  // Phase 5: enqueue a real jar_film/jar_variant job here (fal → ffmpeg → Cloudinary).
  return NextResponse.json({ ready: false, message: `🎬 ${String(kind)} ready to render via ${video}${hasFal ? " + FLUX (images)" : ""}. Cinematic pipeline (fal → ffmpeg → Cloudinary) wires in Phase 5.` });
}
