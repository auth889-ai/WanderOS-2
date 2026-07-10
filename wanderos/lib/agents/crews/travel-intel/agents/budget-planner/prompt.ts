type Ctx = { destination: string; budget: string; currency?: string; stays: { title: string; price: string }[]; interests?: string[]; ragContext?: string };
export function buildBudgetPrompt(c: Ctx) {
  return `You are a travel budget planner. The traveler has a TOTAL budget of ${c.budget} for a trip to ${c.destination}.
REAL bookable stays here (price = per night): ${c.stays.map((s) => `${s.title} ${s.price}`).join(" | ") || "use a typical local mid-range nightly rate"}.
Interests: ${(c.interests || []).join(", ") || "general"}.
${c.ragContext ? `Relevant memory/context (the traveler's past trips/saved research — use to personalise):\n${c.ragContext}` : ""}

Make this budget PRODUCTIVE: compute a realistic plan that FITS.
- HARD RULE: the summed total (stay + food + activities + transport) MUST be ≤ ${c.budget}. Reduce nights/scope to fit.
  Set feasible:false only if even a minimal 1-night trip can't fit the budget.
- daysAffordable: how many days/nights this budget realistically supports (use the cheapest suitable real stay above, leaving room for food + transport).
- breakdown: a money split with concrete amounts — stay, food, activities, transport (each as a short string like "৳3,800 · 2 nights at Riverside Studio").
- total: the summed spend vs the budget.
- feasible: true if the trip works within budget, false if too tight.
- summary: 1–2 sentences — what this budget gets them.
- tips: 1–3 concrete money-saving tips for ${c.destination}.
Use real numbers grounded in the stay prices. Don't invent stays not listed.
Return JSON: { feasible, daysAffordable, breakdown:{stay,food,activities,transport}, total, summary, tips:[] }.`;
}
