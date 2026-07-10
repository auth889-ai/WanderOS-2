import { END, START, StateGraph } from "@langchain/langgraph";
import { CompiledGraph, NodeWrap } from "@/lib/agents/runtime/graphRunner";
import { profileTrip } from "./agents/profiler/agent";
import { destinationIntelligence } from "./agents/destination-intelligence/agent";
import { matchStays } from "./agents/stay-matcher/agent";
import { designItinerary } from "./agents/activity-curator/agent";
import { optimizeBudget } from "./agents/budget-optimizer/agent";
import { writeItemEvidence } from "./agents/item-evidence-writer/agent";
import { composeTripPlan } from "./composer";
import { enrichTripActivities } from "./external-enrichment";
import { verifyTripPlan } from "./verifier";
import { TripPlannerInput, TripPlannerState, TripPlannerStateType } from "./state";

function externalEnrichmentStatus() {
  const hasPlaces = Boolean(process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY);
  const hasRoutes = Boolean(process.env.GOOGLE_ROUTES_API_KEY || process.env.GOOGLE_MAPS_API_KEY);
  const hasWeather = Boolean(process.env.WEATHER_API_KEY || process.env.OPENWEATHER_API_KEY);
  const hasPhotos = Boolean(process.env.UNSPLASH_ACCESS_KEY || process.env.PEXELS_API_KEY);

  return {
    places: {
      provider: hasPlaces ? "google-places" : "not_configured",
      status: hasPlaces ? "available_for_server_enrichment" : "skipped"
    },
    routes: {
      provider: hasRoutes ? "google-routes" : "not_configured",
      status: hasRoutes ? "available_for_server_enrichment" : "skipped"
    },
    weather: {
      provider: hasWeather ? "weather-provider" : "not_configured",
      status: hasWeather ? "available_for_server_enrichment" : "skipped"
    },
    photos: {
      provider: hasPhotos ? "unsplash" : "not_configured",
      status: hasPhotos ? "available_for_server_enrichment" : "skipped"
    }
  };
}

/**
 * Trip Planner LangGraph.
 * Linear by design: each node has one product responsibility and deterministic composer/verifier gate persistence.
 */
export function buildTripPlannerGraph(node: NodeWrap): CompiledGraph<TripPlannerInput, TripPlannerStateType> {
  const graph = new StateGraph(TripPlannerState)
    .addNode(
      "profile_node",
      node<TripPlannerStateType>("trip-profiler", "groq-extract", async (s) => {
        const profile = await profileTrip(s.brief);
        return { profile };
      })
    )
    .addNode(
      "destination_node",
      node<TripPlannerStateType>("destination-intelligence", "pro", async (s) => {
        const destinationIntel = await destinationIntelligence({
          brief: s.brief,
          profile: s.profile
        });
        return { destinationIntel };
      })
    )
    .addNode(
      "stay_node",
      node<TripPlannerStateType>("stay-matcher", "pgvector", async (s) => {
        const matched = await matchStays({
          brief: s.brief,
          profile: s.profile,
          destinationIntel: s.destinationIntel
        });
        return { stayRecommendations: matched.recommendations };
      })
    )
    .addNode(
      "design_node",
      node<TripPlannerStateType>("itinerary-designer", "pro-itinerary-design", async (s) => {
        const designed = await designItinerary({
          brief: s.brief,
          profile: s.profile,
          destinationIntel: s.destinationIntel,
          stayRecommendations: s.stayRecommendations
        });
        return {
          dayArchitecture: designed.dayArchitecture,
          activityCandidates: designed.items,
          logistics: {
            items: designed.items,
            warnings: designed.warnings,
            reasoning: designed.reasoning
          }
        };
      })
    )
    .addNode(
      "enrichment_node",
      node<TripPlannerStateType>("place-photo-enrichment", "google-places-unsplash", async (s) => {
        const enriched = await enrichTripActivities({
          brief: s.brief,
          dayArchitecture: s.dayArchitecture,
          items: s.logistics.items
        });
        return {
          enrichedItems: enriched.items,
          externalEnrichment: enriched.summary
        };
      })
    )
    .addNode(
      "evidence_node",
      node<TripPlannerStateType>("item-evidence-writer", "grounded-pro-evidence", async (s) => {
        const explained = await writeItemEvidence({
          brief: s.brief,
          profile: s.profile,
          destinationIntel: s.destinationIntel,
          dayArchitecture: s.dayArchitecture,
          items: s.enrichedItems
        });
        return { explainedItems: explained.items };
      })
    )
    .addNode(
      "budget_node",
      node<TripPlannerStateType>("budget-optimizer", "reasoning", async (s) => {
        const budgetPlan = await optimizeBudget({
          brief: s.brief,
          profile: s.profile,
          stayRecommendations: s.stayRecommendations,
          dayArchitecture: s.dayArchitecture,
          items: s.explainedItems
        });
        return { budgetPlan };
      })
    )
    .addNode(
      "composer_node",
      node<TripPlannerStateType>("trip-composer", "deterministic-compose", async (s) => {
        const verifiedPlan = composeTripPlan({
          brief: s.brief,
          profile: s.profile,
          destinationIntel: s.destinationIntel,
          stayRecommendations: s.stayRecommendations,
          dayArchitecture: s.dayArchitecture,
          items: s.explainedItems,
          logisticsWarnings: s.logistics.warnings,
          budgetPlan: s.budgetPlan,
          externalEnrichment: {
            configured: externalEnrichmentStatus(),
            result: s.externalEnrichment
          }
        });
        return { verifiedPlan };
      })
    )
    .addNode(
      "verifier_node",
      node<TripPlannerStateType>("trip-verifier", "zod-business-rules", async (s) => {
        const verifierReport = verifyTripPlan({
          destination: s.brief.destination,
          startDate: s.brief.startDate,
          endDate: s.brief.endDate,
          pace: s.profile.pace,
          budget: s.profile.budget ?? s.brief.budget,
          totalEstimate: s.verifiedPlan.totalEstimate,
          days: s.verifiedPlan.days,
          items: s.verifiedPlan.items,
          allowedStayListingIds: s.stayRecommendations.map((stay) => stay.listingId)
        });

        if (verifierReport.status === "failed") {
          throw new Error(`Trip plan failed verification: ${verifierReport.errors.join("; ")}`);
        }

        return { verifierReport };
      })
    )
    .addEdge(START, "profile_node")
    .addEdge("profile_node", "destination_node")
    .addEdge("destination_node", "stay_node")
    .addEdge("stay_node", "design_node")
    .addEdge("design_node", "enrichment_node")
    .addEdge("enrichment_node", "evidence_node")
    .addEdge("evidence_node", "budget_node")
    .addEdge("budget_node", "composer_node")
    .addEdge("composer_node", "verifier_node")
    .addEdge("verifier_node", END);

  return graph.compile() as unknown as CompiledGraph<TripPlannerInput, TripPlannerStateType>;
}
