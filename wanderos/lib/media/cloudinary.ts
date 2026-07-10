import { v2 as cloudinary } from "cloudinary";

/**
 * Cloudinary media layer — the ONLY place we touch Cloudinary. Host photos are uploaded here and we
 * store the returned secure URLs (NOT heavy base64 data-URIs), so listing payloads stay tiny, photos
 * are persisted/served via CDN, and the vision crew fetches them by URL.
 */
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

/** Upload one image (base64 data URI or remote URL) → returns the hosted secure URL. */
export async function uploadImage(dataUriOrUrl: string): Promise<string> {
  ensureConfigured();
  const res = await cloudinary.uploader.upload(dataUriOrUrl, {
    folder: "wanderos/listings",
    resource_type: "image",
    // a sensible cap so a giant original doesn't bloat storage/bandwidth (vision doesn't need 4K)
    transformation: [{ width: 1600, height: 1600, crop: "limit", quality: "auto" }]
  });
  return res.secure_url;
}

export type UploadedPostMedia = {
  mediaUrl: string;
  mediaKind: "photo" | "video";
  cloudinaryPublicId: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
};

export async function uploadPostMedia(
  dataUriOrUrl: string,
  input: {
    mediaKind: "photo" | "video";
    folder?: string;
  }
): Promise<UploadedPostMedia> {
  ensureConfigured();
  const isVideo = input.mediaKind === "video";
  const res = await cloudinary.uploader.upload(dataUriOrUrl, {
    folder: input.folder ?? (isVideo ? "wanderos/posts/videos" : "wanderos/posts/photos"),
    resource_type: isVideo ? "video" : "image",
    ...(isVideo ? {} : { transformation: [{ width: 1800, height: 1800, crop: "limit", quality: "auto" }] })
  });

  return {
    mediaUrl: res.secure_url,
    mediaKind: input.mediaKind,
    cloudinaryPublicId: res.public_id,
    width: typeof res.width === "number" ? res.width : null,
    height: typeof res.height === "number" ? res.height : null,
    durationSeconds: typeof res.duration === "number" ? res.duration : null
  };
}
