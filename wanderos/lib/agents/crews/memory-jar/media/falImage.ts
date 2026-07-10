import { fal } from "@fal-ai/client";

let configured = false;
function ensure() { if (!configured) { fal.config({ credentials: process.env.FAL_KEY }); configured = true; } }

/** Generate a cinematic image with fal FLUX. Returns a hosted URL (or null if no key / failure). */
export async function generateImage(prompt: string, size: "landscape_16_9" | "portrait_4_3" | "square_hd" = "landscape_16_9", model?: string): Promise<string | null> {
  if (!process.env.FAL_KEY) return null;
  ensure();
  try {
    const r = (await fal.subscribe(model || process.env.FAL_FLUX_MODEL || "fal-ai/flux/dev", {
      input: { prompt, image_size: size, num_images: 1 }
    })) as { data?: { images?: { url: string }[] }; images?: { url: string }[] };
    return r?.data?.images?.[0]?.url ?? r?.images?.[0]?.url ?? null;
  } catch { return null; }
}

/** Premium prompt — a world-class glass memory jar (the #33 quality bar). */
export function premiumJarPrompt(scene: string): string {
  const s = scene && scene !== "A moment" ? scene : "a romantic cherry-blossom Kyoto sunset with a pagoda, Mt Fuji, a calm lake and a couple sitting on a bench";
  return `A hyper-realistic cinematic 3D render of a tall elegant cylindrical glass apothecary memory jar with thick crystal-clear glass, sealed with an ornate polished brass screw-top lid with a finial, standing on a wide ornate engraved brass pedestal base, centered on a dark charcoal background, dramatic studio product lighting. Inside the jar is an exquisitely detailed glowing miniature diorama of ${s}, with tiny glowing lanterns and floating sparkles. Luminous streams of golden sparkling light spiral elegantly around the outside of the glass. A glowing neon coral-red heartbeat ECG line with a small glowing heart floats near the base inside. Volumetric god rays, bokeh, intricate detail, octane render, unreal engine 5, 8k, magical, premium, award-winning, no text, no watermark, no UI.`;
}

import { readFileSync } from "fs";
import { join } from "path";

// the #33 reference jar — kept locked as the SHAPE for every generated jar (img2img preserves the form, swaps the scene)
let refJarUrl: string | null = null;
async function jarReferenceUrl(): Promise<string | null> {
  if (refJarUrl) return refJarUrl;
  try {
    const buf = readFileSync(join(process.cwd(), "public/jar/templates/t0.png"));
    refJarUrl = await fal.storage.upload(new Blob([buf], { type: "image/png" }));
    return refJarUrl;
  } catch { return null; }
}

/**
 * Generate a WORLD-CLASS memory jar that keeps the EXACT #33 jar shape (wide jar, tilted gold lid, chunky gold base,
 * swirling ribbons) and only swaps the scene inside — via fal FLUX image-to-image on the #33 reference.
 * Falls back to flux-pro ultra text-to-image if the reference is unavailable.
 */
export async function generateJar(scene: string): Promise<string | null> {
  if (!process.env.FAL_KEY) return null;
  ensure();
  const s = scene && scene !== "A moment" ? scene : "a romantic cherry-blossom Kyoto sunset with a pagoda, a mountain and a couple on a bench";
  const ref = await jarReferenceUrl();
  if (ref) {
    try {
      const r = (await fal.subscribe("fal-ai/flux/dev/image-to-image", {
        input: {
          image_url: ref, strength: 0.78, num_inference_steps: 40,
          prompt: `the exact same magical glass memory jar with a tilted brass-gold lid, a chunky ornate brass-gold base and swirling golden light ribbons spiraling around it, on a dark background, but the glowing miniature diorama scene INSIDE the jar is now ${s}; a neon coral heartbeat heart glows near the base; cinematic, ultra detailed, octane render, 8k, no text, no watermark`
        }
      })) as { data?: { images?: { url: string }[] }; images?: { url: string }[] };
      const url = r?.data?.images?.[0]?.url ?? r?.images?.[0]?.url;
      if (url) return url;
    } catch { /* fall through to text-to-image */ }
  }
  try {
    const r = (await fal.subscribe(process.env.FAL_JAR_MODEL || "fal-ai/flux-pro/v1.1-ultra", {
      input: { prompt: premiumJarPrompt(s), aspect_ratio: "3:4", num_images: 1, safety_tolerance: "5" }
    })) as { data?: { images?: { url: string }[] }; images?: { url: string }[] };
    const url = r?.data?.images?.[0]?.url ?? r?.images?.[0]?.url;
    if (url) return url;
  } catch { /* fall through */ }
  return generateImage(premiumJarPrompt(s), "portrait_4_3", "fal-ai/flux-pro/v1.1");
}

/** Make any Cloudinary media URL displayable as an image — videos → first-frame poster (so_0 .jpg). */
export function posterUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.includes("/image/upload/")) return url;
  if (url.includes("/video/upload/")) return url.replace("/video/upload/", "/video/upload/so_0/").replace(/\.(mp4|mov|webm)$/i, "") + ".jpg";
  return url;
}

export function backgroundPrompt(c: { weather?: string }): string {
  const weather = (c.weather || "twilight").replace(/_/g, " ");
  return `Wide ultra-cinematic magical cherry blossom sakura forest at ${weather}, glowing hanging paper lanterns, deep purple and warm gold bokeh, soft falling petals, a rustic wooden table in the foreground with a vintage camera and a coffee cup, dreamy ethereal atmosphere, volumetric light, ultra detailed, photoreal, no text, no people, no UI.`;
}

/** A COMPLETE photoreal magical memory jar (like the reference): brass-gold lid, swirling golden light ribbons, a miniature world inside, a glowing heartbeat heart, gold base, on a dark background. */
export function jarScenePrompt(c: { place?: string; topMoment?: string; weather?: string }): string {
  const place = c.place && c.place !== "A moment" ? c.place : "a romantic cherry-blossom landscape with a pagoda, a mountain, and a lake";
  const weather = (c.weather || "golden sunset").replace(/_/g, " ");
  return `A photoreal magical glass memory jar standing on an ornate brass-gold base with a shiny brass-gold lid, centered on a plain dark background. Inside the jar is a tiny luminous diorama world of ${place}, ${weather} sky, cherry blossom trees, glowing miniature lanterns, a couple sitting on a small bench looking at the view, sparkling fireflies and floating petals. Glowing golden light ribbons spiral around the outside of the jar. A softly glowing neon heart with a heartbeat ECG line floats near the base inside. Cinematic, ultra detailed, 3D render, magical, warm gold and purple glow, depth of field, no text, no watermark.`;
}

const STYLE_MOD: Record<string, string> = {
  Cyberpunk: "reimagined as a neon cyberpunk world, rain-soaked streets, glowing neon signs, blade-runner mood",
  Snowy: "reimagined in deep winter, soft falling snow, frosted rooftops, cozy warm window light",
  "Studio Ghibli": "in Studio Ghibli anime style, hand-painted, soft pastel watercolor, whimsical"
};
export function variantPrompt(base: { place?: string }, style: string): string {
  const place = base.place && base.place !== "A moment" ? base.place : "a travel memory";
  return `${place}, ${STYLE_MOD[style] ?? style}, cinematic, highly detailed, atmospheric, no text.`;
}
