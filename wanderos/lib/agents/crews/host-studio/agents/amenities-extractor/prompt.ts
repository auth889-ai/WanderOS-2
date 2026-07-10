import { AmenitiesInput } from "./schema";

/** Builds the amenities-extractor instruction — deterministic, honest fact extraction. */
export function buildAmenitiesPrompt(input: AmenitiesInput): string {
  return `You are a precise listing fact extractor for a ${input.category}. Extract the DEFINITIVE structured
facts from the evidence below. Be literal and honest: only assert what the evidence supports; do NOT invent
amenities or rules. When a count is not stated, infer the most sensible value and flag it in missingInfo.

EVIDENCE
- Host notes: ${input.notes}
- Amenities detected from photos: ${input.detectedAmenities.join(", ") || "(none)"}
- Rooms seen in photos: ${input.roomsCovered.join(", ") || "(none)"}

EXTRACT
- amenities: canonical, de-duplicated (merge "wifi"/"WiFi"/"internet" → "WiFi")
- standoutAmenities: the few that most influence bookings
- bedrooms / bathrooms / maxGuests: infer sensibly (studio = 0 bedrooms); bathrooms may be 0.5 increments
- bedConfiguration: only if the notes/rooms imply it (else empty)
- houseRules: ONLY rules supported by the notes (else empty — never fabricate rules)
- missingInfo: anything you had to assume or that the host must confirm
- confidence (0-1) and reasoning (how you inferred counts and normalized amenities)`;
}
