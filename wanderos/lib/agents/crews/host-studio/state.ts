import { Annotation } from "@langchain/langgraph";
import { PhotoAnalysis } from "./agents/property-vision/schema";
import { PropertyProfile } from "./agents/vision-aggregator/schema";
import { ListingCopy } from "./agents/listing-copywriter/schema";
import { Pricing } from "./agents/pricing-analyst/schema";
import { AmenitiesFacts } from "./agents/amenities-extractor/schema";
import { TrustSafetyVerdict } from "./agents/trust-safety-reviewer/schema";
import { ListingDetails } from "./agents/listing-detailer/schema";
import { TagAndEmbedResult } from "./agents/tagging-embedder/schema";
import { QualityGateResult } from "./agents/quality-gate/schema";
import { ComposedListing } from "./agents/final-composer/schema";

/** What the host submits to start the crew. listingId is pre-generated so the embedding can use it. */
export type StudioInput = {
  userId?: string | null;
  listingId: string;
  category: string;
  city: string;
  country: string;
  notes: string;
  photos: string[]; // image urls / data uris
};

/**
 * The shared LangGraph state for the Host Studio crew. Each agent reads upstream channels and
 * writes its own — the graph runs independent channels in parallel. last-value-wins per channel.
 */
export const StudioState = Annotation.Root({
  // passthrough input
  userId: Annotation<string | null>(),
  listingId: Annotation<string>(),
  category: Annotation<string>(),
  city: Annotation<string>(),
  country: Annotation<string>(),
  notes: Annotation<string>(),
  photos: Annotation<string[]>(),

  // agent outputs (channels)
  visionAnalyses: Annotation<PhotoAnalysis[]>(),
  profile: Annotation<PropertyProfile>(),
  copy: Annotation<ListingCopy>(),
  pricing: Annotation<Pricing>(),
  amenities: Annotation<AmenitiesFacts>(),
  safety: Annotation<TrustSafetyVerdict>(),
  details: Annotation<ListingDetails>(),
  tags: Annotation<TagAndEmbedResult>(),
  gate: Annotation<QualityGateResult>(),
  composed: Annotation<ComposedListing>()
});

export type StudioStateType = typeof StudioState.State;
