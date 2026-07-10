import { CopywriterInput } from "./schema";

/** Builds the listing-copywriter instruction — self-positioned, on-tone, and strictly honest. */
export function buildCopywriterPrompt(input: CopywriterInput): string {
  const factsBlock = input.facts
    ? `\n\nCONFIRMED FACTS — your copy MUST be consistent with these and must NOT exceed them:\n- ${input.facts.bedrooms} bedroom(s), ${input.facts.bathrooms} bathroom(s), sleeps ${input.facts.maxGuests}\n- Amenities present: ${input.facts.amenities.join(", ")}\nDo NOT mention more bedrooms/guests than above, and do NOT claim any amenity not in this list.`
    : "";
  return `You are an expert short-stay listing copywriter. Write compelling, HONEST copy for this
${input.category} in ${input.city}, ${input.country}. Only describe what is supported by the property
profile and host notes — never invent features.

FIRST, decide this listing's POSITIONING (a one-line identity/hook) and the TONE to write in — infer both
from the property's aesthetic and its strongest features below. Then write all copy in that chosen voice.

PROPERTY
- Aesthetic: ${input.aestheticStyle}
- Top highlights: ${input.topHighlights.join(", ")}
- Amenities: ${input.allAmenities.join(", ")}
- Host notes: ${input.notes}${factsBlock}

WRITE
- title: ~5-9 words, specific and inviting
- tagline: one-line hook
- shortDescription: 1-2 sentences for listing cards
- longDescription: 2-3 short paragraphs in the tone you chose
- highlights: 4-6 punchy bullet points
- guestPromise: what the guest will feel/experience
- callToAction: a short closing invitation
- seoKeywords: 4-8 discovery keywords
- confidence (0-1) and reasoning (state the positioning + tone you chose and why)`;
}
