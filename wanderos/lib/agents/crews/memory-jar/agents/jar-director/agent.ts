import { invokeStructured } from "@/lib/ai/structured";
import { buildJarDirectorPrompt } from "./prompt";
import { JarDirectorResult, JarDirectorResultSchema } from "./schema";
export async function directJar(ctx: { memoryContext: string; hint?: string }): Promise<JarDirectorResult> {
  return JarDirectorResultSchema.parse(await invokeStructured(JarDirectorResultSchema, buildJarDirectorPrompt(ctx), { tier: "reasoning" }));
}
