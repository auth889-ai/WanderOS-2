import { invokeStructured } from "@/lib/ai/structured";
import { buildPhotoCuratorPrompt } from "./prompt";
import { PhotoCuratorInputSchema, PhotoCuratorResult, PhotoCuratorResultSchema } from "./schema";
export async function curatePhotos(input: unknown): Promise<PhotoCuratorResult> {
  const parsed = PhotoCuratorInputSchema.parse(input);
  const result = await invokeStructured(PhotoCuratorResultSchema, buildPhotoCuratorPrompt(parsed), { tier: "reasoning" });
  return PhotoCuratorResultSchema.parse(result);
}
