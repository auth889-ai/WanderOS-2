export function buildJarDirectorPrompt(c: { memoryContext: string; hint?: string }) {
  return `You are the art director for a magical "memory jar". Using the traveler's OWN memories below (retrieved by semantic search), design ONE evocative miniature world to live inside their glass jar — a personal symbol of their journeys.
${c.hint ? `The traveler also asked for: "${c.hint}". Honor it while staying true to their memories.` : ""}

Their memories:
${c.memoryContext || "(few memories yet — design something hopeful and wanderlust-filled)"}

Return JSON:
- title: a short cinematic name for this jar (e.g. "Neon Nights of Tokyo").
- emotion: the single dominant feeling it captures.
- scene: a vivid, concrete VISUAL description of the miniature diorama to render inside the jar — name real places/elements from their memories (landmarks, season, time of day, mood, colors, tiny figures). 1–2 sentences, purely visual, no abstract words.`;
}
