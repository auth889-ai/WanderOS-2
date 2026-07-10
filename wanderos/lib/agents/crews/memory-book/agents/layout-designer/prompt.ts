import { LayoutDesignerInput } from "./schema";
export function buildLayoutDesignerPrompt(input: LayoutDesignerInput) {
  const spreads = input.spreads.map((s) => `spread ${s.index}: ${s.photoCount} photos, quote:${s.hasQuote}, titlePage:${s.isTitle}`).join("\n");
  return `You are the layout-designer for a Memory Book. For EACH spread, choose the best-fitting template KEY from this exact list:
${input.templateKeys.join(", ")}

Guidance:
- titlePage:true  -> "title-page"
- 1 photo + quote -> "full-bleed-quote"
- 2 photos        -> "hero-left" or "journal-2col"
- 3 photos        -> "grid-3"
- 4+ photos       -> "polaroid-scatter"
- text-heavy / few photos -> "journal-2col"
Choose ONLY from the list. Theme: ${input.theme}.

Spreads:
${spreads}

Return JSON: { layouts:[{ spreadIndex, templateKey }] } — one per spread.`;
}
