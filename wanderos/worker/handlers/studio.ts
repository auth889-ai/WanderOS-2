import { JobHandler } from "@/lib/queue/runner";
import { runHostStudio, StudioInput } from "@/lib/agents/crews/host-studio";
import { applyStudioDraft } from "@/lib/services/listing.service";

/**
 * studio handler — runs the Host Studio crew (10 nodes) as a worker job.
 * Each agent that completes reports live progress to the agent_jobs row (→ SSE → the host UI),
 * and we check cancel at every node boundary. The crew output (draft + Airbnb-depth details) is
 * returned and persisted to agent_jobs.output for the host to review/edit.
 */
const STAGE_LABELS: Record<string, string> = {
  "property-vision": "Analyzing your photos",
  "vision-aggregator": "Building the property profile",
  "amenities-extractor": "Extracting facts & amenities",
  "pricing-analyst": "Researching comparable prices",
  "listing-copywriter": "Writing the listing copy",
  "trust-safety": "Safety & policy review",
  "listing-detailer": "Composing room-by-room detail",
  "tagging-embedder": "Tagging & indexing for search",
  "quality-gate": "Quality check",
  "final-composer": "Finalizing your draft"
};
const TOTAL_NODES = 10;

export const studioHandler: JobHandler = async (ctx) => {
  const input = ctx.input as unknown as StudioInput;

  const result = await runHostStudio(input, async ({ name, sequence }) => {
    const percent = Math.min(99, Math.round((sequence / TOTAL_NODES) * 100));
    await ctx.reportProgress(percent, STAGE_LABELS[name] ?? name);
    await ctx.throwIfCancelled(); // host can cancel between agents
  });

  // commit the AI draft into the listing row (service writes; snapshots version 1) so the host can review/edit it
  if (input.listingId) await applyStudioDraft(input.listingId, { draft: result.draft, details: result.details, photos: input.photos });

  return {
    runId: result.runId,
    draft: result.draft,
    details: result.details,
    gateValid: result.gateValid,
    gatePublishable: result.gatePublishable
  } as unknown as Record<string, unknown>;
};
