import { TrustSafetyInput } from "./schema";

/** Builds the trust-safety instruction — a strict, category-by-category policy review. */
export function buildTrustSafetyPrompt(input: TrustSafetyInput): string {
  return `You are a Trust & Safety reviewer for a short-stay marketplace. Review the listing below and
judge it across FOUR risk categories. Be fair but strict — protect guests and uphold policy.

LISTING
- Category: ${input.category}
- Title: ${input.title}
- Description: ${input.description}
- Host notes: ${input.notes}
- Amenities: ${input.amenities.join(", ") || "(none)"}
- House rules: ${input.houseRules.join(", ") || "(none)"}

CHECK EACH CATEGORY
1. Discrimination (fair housing): any exclusion/preference by race, religion, gender, family status,
   nationality, disability, etc. (e.g. "no children", "females only") → a violation.
2. Scam / misrepresentation: unrealistic claims, fake-sounding listing, off-platform payment, bait pricing.
3. Physical safety: unsafe conditions, dangerous claims, missing critical safety info.
4. Prohibited content: illegal activity, weapons, drugs, hate, adult services.

DECIDE
- verdict: approve (clean) | flag (host should fix) | reject (serious violation)
- riskLevel: low | medium | high
- flags: list each concrete problem (empty if none)
- discriminationCheck / scamCheck / safetyCheck / prohibitedContentCheck: one line each on what you found
- recommendations: concrete fixes (empty if approve)
- confidence (0-1) and reasoning`;
}
