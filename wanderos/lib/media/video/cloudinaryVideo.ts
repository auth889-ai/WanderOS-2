import { v2 as cloudinary } from "cloudinary";

/** Cloudinary video layer — publishes the final MP4 and derives a custom thumbnail. */
let configured = false;
function ensureConfigured() {
  if (configured) return;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_KEY,
    api_secret: process.env.CLOUDINARY_SECRET,
    secure: true
  });
  configured = true;
}

/** Upload a local MP4 → { url, thumbnailUrl, durationSec }. Thumbnail = a frame ~1s in. */
export async function uploadVideo(localPath: string): Promise<{ url: string; thumbnailUrl: string; durationSec: number }> {
  ensureConfigured();
  const res = await cloudinary.uploader.upload(localPath, {
    folder: "wanderos/videos",
    resource_type: "video"
  });
  const thumbnailUrl = cloudinary.url(res.public_id, {
    resource_type: "video",
    format: "jpg",
    transformation: [{ start_offset: "1", width: 1280, crop: "limit", quality: "auto" }]
  });
  return { url: res.secure_url, thumbnailUrl, durationSec: res.duration ?? 0 };
}
