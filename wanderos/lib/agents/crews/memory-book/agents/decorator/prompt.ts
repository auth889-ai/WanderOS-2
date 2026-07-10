import { DecoratorInput } from "./schema";
export function buildDecoratorPrompt(input: DecoratorInput) {
  const spreads = input.spreads.map((s) => `spread ${s.index}: vibe ${s.vibe}`).join("\n");
  return `You are the decorator for a scrapbook Memory Book (theme: ${input.theme}).
For each spread add 2–4 TASTEFUL decorations that match the theme — never cover the photos/text (place near edges/corners).
- cherry-blossom -> 🌸 blossoms, washi tape
- vintage        -> stamps, tape, ✈️ 🧭
- whimsical-dream -> ✨ stars, 🎈
- sunset-coast   -> 🌅 🌴 shells
- mono-minimal   -> a single subtle line/dot
Use xRatio/yRatio in 0..1 (corners ~0.05 or ~0.9). variant = washi|tape|stamp|blossom|star|leaf|heart; emoji optional.

Spreads:
${spreads}

Return JSON: { spreads:[{ spreadIndex, decorations:[{ variant, emoji?, side, xRatio, yRatio, rotation }] }] }`;
}
