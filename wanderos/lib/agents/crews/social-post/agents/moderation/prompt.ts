import { ModerationInput } from "./schema";

export function buildModerationPrompt(input: ModerationInput) {
  return `You are WanderOS social feed moderation.

Decide if this AI-drafted traveler post can move to pending_review or approved.

Policy:
- Block doxxing, private contact info, hate/harassment, sexual content involving minors, unsafe instructions, and illegal solicitation.
- Reject obvious fake commerce claims.
- If it says or implies "verified stay" but verifiedStay=false, reject or require edits.
- If content is generally safe but should be checked by a human, use pending_review.
- Use approved only when it is safe, honest, and not privacy-risky.

Context:
verifiedStay: ${input.verifiedStay}
hasBookingId: ${input.hasBookingId}
hasListingId: ${input.hasListingId}
visualSummary: ${input.visualSummary}
shotHonestyNotes: ${input.honestyNotes.join("; ") || "none"}

Post:
title: ${input.title}
caption: ${input.caption}
body: ${input.body}
tags: ${input.tags.join(", ")}

Return JSON: status, reasons[], privacyFlags[], honestyNotes[], requiredEdits[].`;
}
