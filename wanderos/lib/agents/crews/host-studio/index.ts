import { runGraph, StepInfo } from "@/lib/agents/runtime/graphRunner";
import { buildHostStudioGraph } from "./graph";
import { StudioInput, StudioStateType } from "./state";
import { ComposedListing } from "./agents/final-composer/schema";
import { ListingDetails } from "./agents/listing-detailer/schema";

export type { StudioInput } from "./state";

export type HostStudioResult = {
  runId: string;
  draft: ComposedListing;
  details: ListingDetails; // Airbnb-depth: rooms · offers · house rules · location
  gateValid: boolean;
  gatePublishable: boolean;
};

/**
 * Run the Host Studio crew: photos + notes -> a complete, validated ListingDraft.
 * Wrapped in runGraph so the whole crew is one agent_run with every node logged to agent_steps
 * (the observable trace). Returns the composed draft + the quality-gate verdict.
 */
export async function runHostStudio(
  input: StudioInput,
  onStep?: (info: StepInfo) => Promise<void> | void
): Promise<HostStudioResult> {
  const { runId, output } = await runGraph<StudioInput, StudioStateType, Omit<HostStudioResult, "runId">>({
    workflow: "host-studio",
    userId: input.userId ?? null,
    input,
    build: (node) => buildHostStudioGraph(node),
    onStep,
    finalize: (final) => ({
      draft: final.composed,
      details: final.details,
      gateValid: final.gate?.valid ?? false,
      gatePublishable: final.gate?.publishable ?? false
    })
  });
  return { runId, ...output };
}
