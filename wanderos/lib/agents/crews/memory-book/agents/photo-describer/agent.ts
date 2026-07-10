import { invokeStructuredVision } from "@/lib/ai/structured";
import { buildPhotoDescriberPrompt } from "./prompt";
import { PhotoDescriberInputSchema, PhotoDescriberResult, PhotoDescriberResultSchema } from "./schema";

/** Vision-describe a batch of up to 6 photo URLs (used to ground manually-uploaded photos). */
export async function describePhotoBatch(input: unknown): Promise<PhotoDescriberResult> {
  const parsed = PhotoDescriberInputSchema.parse(input);
  const result = await invokeStructuredVision(PhotoDescriberResultSchema, buildPhotoDescriberPrompt(parsed.urls.length), parsed.urls, { tier: "flash" });
  return PhotoDescriberResultSchema.parse(result);
}
