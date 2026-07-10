import { invokeStructured } from "@/lib/ai/structured";
import { buildJarRecapPrompt } from "./prompt";
import { JarRecapResult, JarRecapResultSchema } from "./schema";
export async function getJarRecap(ctx: Parameters<typeof buildJarRecapPrompt>[0]): Promise<JarRecapResult> {
  return JarRecapResultSchema.parse(await invokeStructured(JarRecapResultSchema, buildJarRecapPrompt(ctx), { tier: "reasoning" }));
}
