import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getComparables, getCityComparables } from "@/lib/db/tables/listings";
import { locationIntelTool, seasonalDemandTool, externalPricingTools } from "./external-tools";

/**
 * Tools the pricing-analyst agent can CALL ITSELF (true action-taking).
 * The LLM decides when to search same-category comps and when to broaden — it acts, observes
 * the returned comps, and decides the next step. Each tool returns real Aurora data as JSON.
 */

export const searchComparablesTool = tool(
  async ({ city, category }: { city: string; category: string }) => {
    const comps = await getComparables({ city, category, limit: 8 });
    return JSON.stringify(comps);
  },
  {
    name: "searchComparables",
    description: "Find approved, priced listings in the same city AND category. Use this first to price the property.",
    schema: z.object({
      city: z.string().describe("the property's city"),
      category: z.string().describe("the property's category, e.g. apartment, villa")
    })
  }
);

export const broadenSearchTool = tool(
  async ({ city }: { city: string }) => {
    const comps = await getCityComparables({ city, limit: 8 });
    return JSON.stringify(comps);
  },
  {
    name: "broadenSearch",
    description:
      "Broaden the comp search to ALL categories in the city. Call this if searchComparables returned too few (< 3) comps.",
    schema: z.object({ city: z.string().describe("the property's city") })
  }
);

/** All tools (internal Aurora comps + external market intelligence), plus a name→tool map for the agent loop. */
export const pricingTools = [searchComparablesTool, broadenSearchTool, ...externalPricingTools];
export const pricingToolMap: Record<string, (typeof pricingTools)[number]> = {
  searchComparables: searchComparablesTool,
  broadenSearch: broadenSearchTool,
  locationIntel: locationIntelTool,
  seasonalDemand: seasonalDemandTool
};
