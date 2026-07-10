import { z } from "zod";
export const ResolverResultSchema = z.object({
  destination: z.string(),
  interests: z.array(z.string()).max(8),
  travelStyle: z.string().optional(),
  budget: z.string().optional(),       // extracted from the sentence if mentioned, e.g. "৳8,000"
  dateFrom: z.string().optional(),     // ISO yyyy-mm-dd, resolved from relative phrases ("next month", "for Eid")
  dateTo: z.string().optional()
});
export type ResolverResult = z.infer<typeof ResolverResultSchema>;
