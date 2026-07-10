export function buildCultureTipsPrompt(destination: string, country: string, weather?: string) {
  return `You are a seasoned local travel expert for ${destination}, ${country}. Give PRACTICAL "know before you go" guidance.
${weather ? `Current 7-day weather: ${weather}.` : ""}
Be specific and honest; if unsure of a detail, keep it general but useful (never invent precise prices/laws).
Return JSON:
- bestTime: best season/months to visit and why (1 sentence).
- gettingAround: how to get around locally (1 sentence).
- etiquette: 2–4 short cultural/etiquette tips a visitor should know.
- safety: one practical safety note.
- moneyTip: one money/budget tip (cash vs card, bargaining, tipping…).
- dontMiss: one signature experience not to miss.`;
}
