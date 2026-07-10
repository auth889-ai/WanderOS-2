import { z } from "zod";
import { flexStringArray, confidence01, lowerEnum } from "@/lib/ai/zod-helpers";

/**
 * pricing-analyst — input + output contracts.
 * The agent gathers REAL comps via its tools (it decides when to broaden), then prices.
 */
export type PricingInput = {
  city: string;
  country: string;
  category: string;
  qualityScore: number; // from aggregator (0-100)
  amenities: string[]; // from aggregator
};

export const PricingSchema = z.object({
  currency: z.string().describe("currency code inferred from the country (e.g. BDT, USD)"),
  suggested: z.number().describe("recommended nightly price"),
  min: z.number().describe("low end of the sensible range"),
  max: z.number().describe("high end of the sensible range"),
  comparableIds: flexStringArray.describe("ids of the comparable listings actually used to set the price"),
  priceFactors: flexStringArray.describe("concrete factors that pushed the price up or down vs the comps"),
  locationFactor: z.string().describe("what the real-world location signal (nearby attractions) implied for price — or 'not checked'"),
  demandFactor: z.string().describe("what upcoming events/holidays implied for price — or 'not checked'"),
  dataQuality: lowerEnum(["none", "thin", "adequate", "strong"]).describe("how much real comp data backed this price"),
  justification: z.string().describe("why this price, referencing the comparables by their values"),
  confidence: confidence01.describe("confidence in the price, 0-1 (lower when comp data is thin)"),
  reasoning: z.string().describe("the analyst's reasoning, including any broadening decision")
});

export type Pricing = z.infer<typeof PricingSchema>;
