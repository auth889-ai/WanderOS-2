import { z } from "zod";
import { flexStringArray, confidence01, lowerEnum } from "@/lib/ai/zod-helpers";

/**
 * trust-safety-reviewer — input + output contracts.
 * Reviews the assembled listing for policy/safety problems before it can be published. It does not
 * write content — it JUDGES it across distinct risk categories and returns a verdict + flags.
 */
export type TrustSafetyInput = {
  category: string;
  title: string;
  description: string;
  notes: string;
  amenities: string[];
  houseRules: string[];
};

export const TrustSafetySchema = z.object({
  verdict: lowerEnum(["approve", "flag", "reject"]).describe("approve = safe; flag = host should fix; reject = serious violation"),
  riskLevel: lowerEnum(["low", "medium", "high"]).describe("overall risk level"),
  flags: flexStringArray.describe("specific problems found (empty if none)"),
  discriminationCheck: z.string().describe("result of the fair-housing / discrimination check"),
  scamCheck: z.string().describe("result of the scam / misrepresentation / fake-listing check"),
  safetyCheck: z.string().describe("result of the physical-safety / unsafe-claim check"),
  prohibitedContentCheck: z.string().describe("result of the illegal / prohibited-content check"),
  recommendations: flexStringArray.describe("concrete fixes the host should make (empty if none)"),
  confidence: confidence01.describe("confidence in this assessment, 0-1"),
  reasoning: z.string().describe("how the verdict was reached")
});

export type TrustSafetyVerdict = z.infer<typeof TrustSafetySchema>;
