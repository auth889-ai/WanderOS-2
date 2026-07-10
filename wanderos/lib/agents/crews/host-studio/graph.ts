import { StateGraph, START, END } from "@langchain/langgraph";
import { NodeWrap, CompiledGraph } from "@/lib/agents/runtime/graphRunner";
import { StudioState, StudioStateType, StudioInput } from "./state";

import { propertyVision } from "./agents/property-vision/agent";
import { visionAggregator } from "./agents/vision-aggregator/agent";
import { listingCopywriter } from "./agents/listing-copywriter/agent";
import { pricingAnalyst } from "./agents/pricing-analyst/agent";
import { amenitiesExtractor } from "./agents/amenities-extractor/agent";
import { trustSafetyReviewer } from "./agents/trust-safety-reviewer/agent";
import { listingDetailer } from "./agents/listing-detailer/agent";
import { taggingEmbedder } from "./agents/tagging-embedder/agent";
import { qualityGate } from "./agents/quality-gate/agent";
import { finalComposer } from "./agents/final-composer/agent";

/**
 * Builds + compiles the Host Studio LangGraph. Every node is wrapped by `node()` so it logs to
 * agent_steps. Shape (linear, prevention-based — no supervisor, no debate loop):
 *   vision(map) -> aggregator -> amenities(facts) -> pricing(ReAct) -> copywriter(from facts)
 *   -> trust-safety -> detailer -> tagging+embed -> quality-gate(deterministic) -> final-composer(deterministic).
 * Consistency is enforced BY CONSTRUCTION (copywriter gets the facts as hard constraints) and verified
 * by the deterministic quality-gate — no expensive critic loop.
 */
export function buildHostStudioGraph(node: NodeWrap): CompiledGraph<StudioInput, StudioStateType> {
  const graph = new StateGraph(StudioState)
    .addNode(
      "vision_node",
      node<StudioStateType>("property-vision", "vision", async (s) => {
        const visionAnalyses = await Promise.all(
          (s.photos ?? []).map((imageUrl) => propertyVision({ imageUrl, category: s.category }))
        );
        return { visionAnalyses };
      })
    )
    .addNode(
      "aggregator_node",
      node<StudioStateType>("vision-aggregator", "synthesis", async (s) => {
        const profile = await visionAggregator({ category: s.category, notes: s.notes, analyses: s.visionAnalyses });
        return { profile };
      })
    )
    .addNode(
      "copywriter_node",
      node<StudioStateType>("listing-copywriter", "openai", async (s) => {
        const copy = await listingCopywriter({
          category: s.category,
          city: s.city,
          country: s.country,
          topHighlights: s.profile.topHighlights,
          allAmenities: s.profile.allAmenities,
          aestheticStyle: s.profile.aestheticStyle,
          notes: s.notes,
          // authoritative facts (amenities ran first) — copy must stay consistent with these
          facts: {
            bedrooms: s.amenities.bedrooms,
            bathrooms: s.amenities.bathrooms,
            maxGuests: s.amenities.maxGuests,
            amenities: s.amenities.amenities
          }
        });
        return { copy };
      })
    )
    .addNode(
      "pricing_node",
      node<StudioStateType>("pricing-analyst", "tools", async (s) => {
        const pricing = await pricingAnalyst({
          city: s.city,
          country: s.country,
          category: s.category,
          qualityScore: s.profile.overallQuality,
          amenities: s.profile.allAmenities
        });
        return { pricing };
      })
    )
    .addNode(
      "amenities_node",
      node<StudioStateType>("amenities-extractor", "groq", async (s) => {
        const amenities = await amenitiesExtractor({
          category: s.category,
          notes: s.notes,
          detectedAmenities: s.profile.allAmenities,
          roomsCovered: s.profile.roomsCovered
        });
        return { amenities };
      })
    )
    .addNode(
      "safety_node",
      node<StudioStateType>("trust-safety", "claude", async (s) => {
        const safety = await trustSafetyReviewer({
          category: s.category,
          title: s.copy.title,
          description: s.copy.longDescription,
          notes: s.notes,
          amenities: s.amenities.amenities,
          houseRules: s.amenities.houseRules
        });
        return { safety };
      })
    )
    .addNode(
      "detailer_node",
      node<StudioStateType>("listing-detailer", "places", async (s) => {
        const details = await listingDetailer({
          category: s.category,
          city: s.city,
          country: s.country,
          notes: s.notes,
          rooms: (s.visionAnalyses ?? []).map((a) => ({
            roomType: a.roomType,
            roomLabel: a.roomLabel,
            features: a.features,
            amenities: a.amenities
          })),
          amenities: s.amenities.amenities,
          bedConfiguration: s.amenities.bedConfiguration,
          maxGuests: s.amenities.maxGuests,
          bedrooms: s.amenities.bedrooms,
          bathrooms: s.amenities.bathrooms,
          safetyFlags: s.safety.flags
        });
        return { details };
      })
    )
    .addNode(
      "tagging_node",
      node<StudioStateType>("tagging-embedder", "pgvector", async (s) => {
        const tags = await taggingEmbedder({
          listingId: s.listingId,
          category: s.category,
          city: s.city,
          country: s.country,
          title: s.copy.title,
          description: s.copy.longDescription,
          amenities: s.amenities.amenities
        });
        return { tags };
      })
    )
    .addNode(
      "gate_node",
      node<StudioStateType>("quality-gate", "zod", async (s) => {
        const gate = await qualityGate({
          title: s.copy.title,
          shortDescription: s.copy.shortDescription,
          longDescription: s.copy.longDescription,
          highlights: s.copy.highlights,
          price: s.pricing.suggested,
          currency: s.pricing.currency,
          bedrooms: s.amenities.bedrooms,
          bathrooms: s.amenities.bathrooms,
          maxGuests: s.amenities.maxGuests,
          amenities: s.amenities.amenities,
          tags: s.tags.tags,
          safetyVerdict: s.safety.verdict
        });
        return { gate };
      })
    )
    .addNode(
      "composer_node",
      node<StudioStateType>("final-composer", "compose", async (s) => {
        const composed = await finalComposer({
          category: s.category,
          city: s.city,
          country: s.country,
          copy: {
            title: s.copy.title,
            shortDescription: s.copy.shortDescription,
            longDescription: s.copy.longDescription,
            highlights: s.copy.highlights
          },
          pricing: {
            suggested: s.pricing.suggested,
            min: s.pricing.min,
            max: s.pricing.max,
            currency: s.pricing.currency,
            confidence: s.pricing.confidence
          },
          amenities: {
            amenities: s.amenities.amenities,
            bedrooms: s.amenities.bedrooms,
            bathrooms: s.amenities.bathrooms,
            maxGuests: s.amenities.maxGuests,
            missingInfo: s.amenities.missingInfo
          },
          safety: { verdict: s.safety.verdict, riskLevel: s.safety.riskLevel, flags: s.safety.flags },
          tags: s.tags.tags,
          vibes: s.tags.vibes
        });
        return { composed };
      })
    )
    .addEdge(START, "vision_node")
    .addEdge("vision_node", "aggregator_node")
    // LINEAR chain (no fan-in diamonds -> no races): facts -> price -> copy (from facts, consistent by construction)
    .addEdge("aggregator_node", "amenities_node")
    .addEdge("amenities_node", "pricing_node")
    .addEdge("pricing_node", "copywriter_node")
    .addEdge("copywriter_node", "safety_node")
    // no critic loop: copy is consistent-by-construction, then the deterministic quality-gate verifies it
    .addEdge("safety_node", "detailer_node")
    .addEdge("detailer_node", "tagging_node")
    .addEdge("tagging_node", "gate_node")
    .addEdge("gate_node", "composer_node")
    .addEdge("composer_node", END);

  return graph.compile() as unknown as CompiledGraph<StudioInput, StudioStateType>;
}
