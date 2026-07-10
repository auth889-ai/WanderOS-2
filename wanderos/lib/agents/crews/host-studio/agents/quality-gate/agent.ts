import { ListingDraftSchema, ListingDraft, QualityGateResult } from "./schema";

/**
 * quality-gate agent — the deterministic structural gate (NO LLM).
 *
 * It normalizes the assembled draft (safe repairs), validates it against the canonical schema, and
 * enforces the one hard business rule: a 'reject' safety verdict is never publishable. Unlike the
 * generative agents, this cannot be argued with — it is the last line of defense before a draft is
 * composed and saved. Returns the cleaned draft or the exact list of what's broken.
 */
export async function qualityGate(input: Record<string, unknown>): Promise<QualityGateResult> {
  const repairs: string[] = [];
  const norm: Record<string, unknown> = { ...input };

  // safe repair 1: trim string fields
  for (const k of ["title", "shortDescription", "longDescription", "currency"]) {
    if (typeof norm[k] === "string") {
      const trimmed = (norm[k] as string).trim();
      if (trimmed !== norm[k]) repairs.push(`trimmed ${k}`);
      norm[k] = trimmed;
    }
  }

  // safe repair 2: de-duplicate + clean array fields
  for (const k of ["highlights", "amenities", "tags"]) {
    if (Array.isArray(norm[k])) {
      const cleaned = (norm[k] as unknown[]).map((v) => String(v).trim()).filter(Boolean);
      const deduped = [...new Set(cleaned)];
      if (deduped.length !== (norm[k] as unknown[]).length) repairs.push(`de-duplicated ${k}`);
      norm[k] = deduped;
    }
  }

  const parsed = ListingDraftSchema.safeParse(norm);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => `${i.path.join(".") || "draft"}: ${i.message}`);
    return { valid: false, publishable: false, errors, repairs, draft: null };
  }

  const draft: ListingDraft = parsed.data;
  const blocked = draft.safetyVerdict === "reject";
  return {
    valid: true,
    publishable: !blocked,
    errors: blocked ? ["safety verdict is 'reject' — cannot publish"] : [],
    repairs,
    draft
  };
}
