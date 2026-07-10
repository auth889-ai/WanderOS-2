import { invokeStructured } from "@/lib/ai/structured";
import { buildResolverPrompt } from "./prompt";
import { ResolverResult, ResolverResultSchema } from "./schema";
export async function resolveDestination(query: string): Promise<ResolverResult> {
  return ResolverResultSchema.parse(await invokeStructured(ResolverResultSchema, buildResolverPrompt(query), { tier: "flash" }));
}
