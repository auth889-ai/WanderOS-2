import { invokeStructured } from "@/lib/ai/structured";
import { TrustSafetySchema, TrustSafetyVerdict, TrustSafetyInput } from "./schema";
import { buildTrustSafetyPrompt } from "./prompt";

/**
 * trust-safety-reviewer agent — judges the listing for policy/safety violations.
 *
 * Uses the "safety" tier (Claude via OpenRouter) — the strongest careful policy reviewer. It only
 * JUDGES (never writes content), returning a verdict + per-category checks + flags. The admin and
 * the critic rely on this; it is advisory (services/admin make the final publish decision).
 */
export async function trustSafetyReviewer(input: TrustSafetyInput): Promise<TrustSafetyVerdict> {
  return invokeStructured(TrustSafetySchema, buildTrustSafetyPrompt(input), { tier: "safety" });
}
