export function buildResolverPrompt(query: string, today = new Date().toISOString().slice(0, 10)) {
  return `You are the intent parser for a travel concierge. Today is ${today}. Extract everything from this natural-language request.
Input: """${query}"""
Return JSON:
- destination: a geocodable place if named or strongly implied, else "".
- interests: 1–6 keywords (beach, food, nature, history, nightlife, festival…).
- travelStyle: one of beach|culture|adventure|foodie|relaxed|family|luxury (best guess) or omit.
- budget: the budget if mentioned (keep the currency, e.g. "৳8,000", "$300"), else omit.
- dateFrom / dateTo: if the request implies dates or a duration, resolve them to ISO yyyy-mm-dd using today's date
  (e.g. "next weekend", "for 3 days in August", "around Eid", "11–27 July"). Omit if no time is implied.
Do not invent a destination if none is implied.`;
}
