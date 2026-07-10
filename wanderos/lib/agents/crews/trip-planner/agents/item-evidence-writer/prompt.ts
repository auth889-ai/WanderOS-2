import type { ItemEvidenceWriterInput } from "./schema";

function join(values?: string[]) {
  return values?.filter(Boolean).join(", ") || "(none)";
}

function compactItem(item: ItemEvidenceWriterInput["items"][number]) {
  return {
    dayNumber: item.dayNumber,
    timeLabel: item.timeLabel,
    title: item.title,
    description: item.description,
    category: item.category,
    estCost: item.estCost,
    costSource: item.costSource,
    costRationale: item.costRationale,
    placeName: item.placeName,
    placeAddress: item.placeAddress,
    placeUrl: item.placeUrl,
    externalPlaceId: item.externalPlaceId,
    placeRating: item.placeRating,
    metadata: {
      googlePlaceSource: item.metadata?.googlePlaceSource,
      googlePlaceTypes: item.metadata?.googlePlaceTypes,
      googleBusinessStatus: item.metadata?.googleBusinessStatus,
      googleUserRatingsTotal: item.metadata?.googleUserRatingsTotal,
      googleWebsite: item.metadata?.googleWebsite,
      googleOpeningHours: item.metadata?.googleOpeningHours,
      googlePriceLevel: item.metadata?.googlePriceLevel,
      imageSource: item.metadata?.imageSource
    }
  };
}

export function buildItemEvidenceWriterPrompt(input: ItemEvidenceWriterInput): string {
  return `You are the item-evidence-writer for WanderOS Trip Planner.

Your job is to turn itinerary items plus real provider evidence into useful traveler-facing explanations.
This must feel like a premium trip operations product, not generic travel copy.

Return JSON matching:
{
  "items": [
    {
      "dayNumber": 1,
      "title": "same item title",
      "description": "specific, practical item description",
      "selectionRationale": "why this stop belongs in this traveler trip, grounded in profile + place evidence",
      "timingRationale": "why this time/day placement is useful, grounded in day area/pace/opening evidence",
      "costRationale": "what evidence supports the estimate, and what is still not exact",
      "travelerTip": "one practical tip",
      "verificationNote": "what source can verify the item"
    }
  ],
  "reasoning": "short note about evidence boundaries"
}

Traveler:
- destination: ${input.brief.destination}
- dates: ${input.brief.startDate || "(unknown)"} to ${input.brief.endDate || "(unknown)"}
- party: ${input.profile.party}
- pace: ${input.profile.pace}
- budget: ${input.profile.budget ?? input.brief.budget ?? "(unknown)"}
- budgetBand: ${input.profile.budgetBand || "(unknown)"}
- style: ${input.profile.travelStyle || input.brief.travelStyle || "(none)"}
- interests: ${join(input.profile.interests)}
- constraints: ${JSON.stringify(input.profile.constraints || {}, null, 2)}

Destination context:
- neighborhoods: ${join(input.destinationIntel.neighborhoods)}
- themes: ${join(input.destinationIntel.themes)}
- warnings: ${join(input.destinationIntel.warnings)}
- days: ${JSON.stringify(input.dayArchitecture.days, null, 2)}

Provider-enriched itinerary items, in exact order. Return exactly one output item per input item in the same order:
${JSON.stringify(input.items.map(compactItem), null, 2)}

Rules:
- Do not invent exact ticket prices, menu prices, live wait times, live transit times, or booking availability.
- If Google returned no price level, say the estimate is conservative and not exact.
- If Google returned website/opening hours/rating, use them as verification evidence.
- If a field is missing, do not pretend it exists.
- Keep title and dayNumber aligned with the input.
- Description should be specific and helpful, not a generic marketing sentence.
- Rationale should explain why this item is suitable for this traveler profile, not why the city is famous.
- No markdown, no HTML, no bullet characters inside strings.`;
}
